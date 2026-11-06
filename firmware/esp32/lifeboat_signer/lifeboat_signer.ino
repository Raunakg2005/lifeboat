// Lifeboat hardware signer for ESP32 DevKit V1 (Arduino core).
//
// Holds the WOTS+C secret seed and the leaf counter; nothing secret ever leaves the device.
//   - the host (laptop/browser) grinds the counter and holds the public Merkle tree (no secret needed)
//   - the device picks the leaf from its own counter, recomputes the digest itself, refuses a bad counter,
//     shows the request on the OLED, waits for the physical Approve button, PERSISTS the counter, and only then
//     computes and streams the 64 chain values
//
// Wiring (3.3 V): OLED SSD1306 SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND
//                 Approve: the on-board BOOT button (or a button D18 -> GND); Reject: D19 -> GND or just wait 60 s
// Serial: 115200 baud, line protocol, every line starts with "WOTS|" (the host ignores anything else):
//   WOTS|PING                          -> WOTS|PONG
//   WOTS|INFO                          -> WOTS|INFO|<nextLeaf>|<pubSeed>|<root>   or  WOTS|INFO|NOKEY
//   WOTS|KEYGEN|<hostEntropy hex32>    -> WOTS|LH|<i>|<leafHash> x256, then WOTS|ROOT|<root>
//   WOTS|LEAVES                        -> re-streams WOTS|LH lines (public; ~40 s), then WOTS|ROOT
//   Clear signing (clear.h): the device never signs a bare hash. Each request carries its own fields; the device
//   rebuilds the hash from them and shows them in words, page by page (BOOT = next page, then BOOT = sign):
//   WOTS|MSG|<counter>|<text hex>                                   a plain-text message
//   WOTS|PQW|<counter>|<chainId>|<wallet>|<leaf>|<deadline>|<calls>   a LifeboatPQWallet execute (ENS, payments…)
//   WOTS|SAFE|<counter>|<chainId>|<guard>|<safe>|<to>|<value>|<data>|<op>|<safeTxGas>|<baseGas>|<gasPrice>|<gasToken>|<refund>|<nonce>
//                                                                   a Quantum Guard co-signature for a Safe tx
//   WOTS|FRAME|<counter>|<unsigned tx hex>                          an EIP-8141 frame transaction
//        -> WOTS|HASH|<sigHash the device computed> -> WOTS|ASK|<leaf> (waits for the button)
//        -> WOTS|SIG|<k>/64|<chain value> x64 -> WOTS|DONE|<leaf>|<keccak of sigs>     or WOTS|ERR|<reason>
//   WOTS|SIGN|…  (a bare hash) is refused: WOTS|ERR|blind-signing-off
//   Only Sepolia (11155111) and the EIP-8141 devnet (1337) are signed for: WOTS|ERR|chain-not-allowed otherwise
// PIN lock (pin.h): the seed is stored encrypted and the device is locked after power-on until the PIN is entered:
//   WOTS|SETPIN|<pin hex>   -> (screen + BOOT) -> WOTS|PINSET        encrypts the seed; the plaintext copy is erased
//   WOTS|UNLOCK|<pin hex>   -> WOTS|UNLOCKED  or WOTS|ERR|bad-pin|<wrong tries in a row> (waits grow after 3)
//   WOTS|LOCK               -> WOTS|LOCKED    (the seed is wiped from memory)
//   WOTS|WIPE               -> (hold BOOT 5 s) -> WOTS|WIPED   erases the key for good
//   INFO ends with |pin=0/1|locked=0/1
//   WOTS|EFUSE                         -> WOTS|EFUSE|<coding scheme of BLOCK3> (read-only, never burns)
//   WOTS|I2C                           -> WOTS|I2C|<addresses that answer>|oled=<addr or none>; re-starts the screen if found
//   WOTS|BENCH                         -> WOTS|BENCH|single_core_est_ms|<n>|dual_core_ms|<n>
//   (keygen and tree export use both cores; the public tree is cached in NVS, so LEAVES is instant after the first time)
// Libraries: SSD1306Ascii (Bill Greiman). Preferences is built into the ESP32 core.
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include "SSD1306Ascii.h"
#include "SSD1306AsciiWire.h"
#include "wots.h"
#include "clear.h"
#include "pin.h"
#if __has_include("bootloader_random.h")
#include "bootloader_random.h"
#define LB_HAVE_BOOTLOADER_RANDOM 1
#endif
#if __has_include("esp_efuse.h")
#include "esp_efuse.h"
#define LB_HAVE_EFUSE 1
#endif

static const int PIN_APPROVE = 18;  // right-side pins: the only ones with a free breadboard hole on a DevKit V1
static const int PIN_REJECT = 19;
static const int PIN_BOOT = 0;  // the board's own BOOT button also approves (no wiring needed); read only after boot
static const uint32_t ASK_TIMEOUT_MS = 90000;

Preferences prefs;
SSD1306AsciiWire oled;
static bool have_key = false;
static bool pin_set = false;  // the seed is stored encrypted (skx)
static bool locked = false;   // pin_set and not unlocked since power-on: nothing can be signed
static uint8_t sk_seed[32], pub_seed[32], root[32];
static uint8_t leaves[lb::LEAVES][32];  // public, only needed during keygen / re-export
static uint8_t sigs[lb::LEN][32];
static cs::Screen screen;  // the request in words

static void hexout(const uint8_t* b, size_t n) {
  static const char* H = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    Serial.write(H[b[i] >> 4]);
    Serial.write(H[b[i] & 15]);
  }
}
static bool unhex(const String& s, uint8_t* out, size_t n) {
  String h = s.startsWith("0x") ? s.substring(2) : s;
  if (h.length() != n * 2) return false;
  for (size_t i = 0; i < n; i++) {
    char buf[3] = {h[2 * i], h[2 * i + 1], 0};
    char* end;
    out[i] = (uint8_t)strtoul(buf, &end, 16);
    if (*end) return false;
  }
  return true;
}
static uint8_t oled_addr = 0;  // 0x3C or 0x3D, whichever answers (0 = no screen found)

/**
 * Probes the two addresses an SSD1306 can have (0x3C, 0x3D), reports which one answers, and (re)starts the screen.
 * Only two probes with a short timeout: a miswired or stuck bus must not stall the signer.
 */
static void scan_i2c() {
  oled_addr = 0;
  int code3c = -1, code3d = -1;
  Wire.beginTransmission(0x3C);
  code3c = Wire.endTransmission();
  if (code3c == 0) oled_addr = 0x3C;
  else {
    Wire.beginTransmission(0x3D);
    code3d = Wire.endTransmission();
    if (code3d == 0) oled_addr = 0x3D;
  }
  if (oled_addr) {
    oled.begin(&Adafruit128x64, oled_addr);
    oled.setFont(System5x7);
  }
  // endTransmission codes: 0 ok, 2 no answer (nothing at that address), 4/5 bus error or timeout (check SDA/SCL wiring)
  Serial.print("WOTS|I2C|0x3C=");
  Serial.print(code3c);
  Serial.print("|0x3D=");
  Serial.print(code3d);
  Serial.print("|oled=");
  Serial.println(oled_addr == 0x3C ? "0x3C" : oled_addr == 0x3D ? "0x3D" : "none");
}

/**
 * Wiring finder: tries the SSD1306 addresses on every pair of safe GPIOs and reports where a screen answers.
 * Skips the flash pins (6-11), the USB serial pins (1, 3), the boot strapping pins (0, 2, 12, 15) and the
 * input-only pins (34-39). Restores the normal pins (SDA 21, SCL 22) afterwards.
 */
static void pin_scan() {
  static const uint8_t P[] = {4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
  int hits = 0;
  for (uint8_t a : P)
    for (uint8_t b : P) {
      if (a == b) continue;
      Wire.end();
      Wire.begin(a, b);
      Wire.setTimeOut(10);
      for (uint8_t addr : {0x3C, 0x3D}) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
          char l[64];
          snprintf(l, sizeof l, "WOTS|PINSCAN|sda=GPIO%u|scl=GPIO%u|addr=0x%02X", a, b, addr);
          Serial.println(l);
          hits++;
        }
      }
    }
  Wire.end();
  for (uint8_t p : P) pinMode(p, INPUT);
  pinMode(PIN_APPROVE, INPUT_PULLUP);
  pinMode(PIN_REJECT, INPUT_PULLUP);
  Wire.begin(21, 22);
  Wire.setClock(100000L);
  Wire.setTimeOut(30);
  Serial.print("WOTS|PINSCAN|done|");
  Serial.println(hits);
}

/**
 * Line test, no I2C: a powered SSD1306 module holds SDA and SCL high through its own pull-up resistors (~4.7-10 kOhm),
 * which beat the ESP32's weak internal pull-down. So with every safe pin pulled down, the pins that still read HIGH
 * are the ones wired to a powered screen. None high = the screen has no power, or its wires don't reach the ESP32.
 */
static void line_test() {
  static const uint8_t P[] = {4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
  Wire.end();
  char high[96] = "";
  for (uint8_t p : P) {
    if (p == PIN_APPROVE || p == PIN_REJECT) continue;  // buttons may be wired there
    pinMode(p, INPUT_PULLDOWN);
  }
  delay(5);
  for (uint8_t p : P) {
    if (p == PIN_APPROVE || p == PIN_REJECT) continue;
    if (digitalRead(p) == HIGH) {
      char h[8];
      snprintf(h, sizeof h, "%sD%u", high[0] ? "," : "", p);
      strncat(high, h, sizeof high - strlen(high) - 1);
    }
  }
  for (uint8_t p : P) if (p != PIN_APPROVE && p != PIN_REJECT) pinMode(p, INPUT);
  Wire.begin(21, 22);
  Wire.setClock(100000L);
  Wire.setTimeOut(30);
  Serial.print("WOTS|LINES|high=");
  Serial.println(high[0] ? high : "none");
}

static void show(const char* l1, const char* l2 = "", const char* l3 = "", const char* l4 = "") {
  if (!oled_addr) return;  // no screen found: keep signing over serial, never touch an absent device
  oled.clear();
  oled.set2X();
  oled.println(l1);
  oled.set1X();
  oled.println(l2);
  oled.println(l3);
  oled.println(l4);
}
static uint32_t next_leaf() { return prefs.getUInt("next", 0); }
static void show_idle() {
  char l3[24];
  snprintf(l3, sizeof l3, have_key ? "next leaf %lu/256" : "no key yet", (unsigned long)next_leaf());
  show(locked ? "LOCKED" : "LIFEBOAT", locked ? "enter the PIN" : "post-quantum signer", l3, !have_key ? "" : pin_set ? (locked ? "on the laptop" : "PIN on, unlocked") : "clear signing on");
}

static void random_bytes(uint8_t* out, size_t n) {
#ifdef LB_HAVE_BOOTLOADER_RANDOM
  bootloader_random_enable();  // true RNG even with the radio off
  esp_fill_random(out, n);
  bootloader_random_disable();
#else
  esp_fill_random(out, n);  // pseudo-random unless the radio is on: host entropy is mixed in below
#endif
}

static void load_key() {
  pin_set = prefs.getBool("pinset", false);
  bool pub_ok = prefs.getBool("keyok", false) && prefs.getBytes("pub", pub_seed, 32) == 32 && prefs.getBytes("root", root, 32) == 32;
  if (pin_set) {
    // encrypted at rest: the seed only exists in memory after UNLOCK
    have_key = pub_ok && prefs.getBytesLength("skx") == 32 && prefs.getBytesLength("salt") == 16 && prefs.getBytesLength("kchk") == 8;
    memset(sk_seed, 0, sizeof sk_seed);
    locked = true;
  } else {
    have_key = pub_ok && prefs.getBytes("sk", sk_seed, 32) == 32;
    locked = false;
  }
}

// ---- leaf computation on both cores ----
// Core 1 (this loop task) computes the even leaves, a helper task pinned to core 0 the odd ones.
static volatile int leaves_done = 0;
static SemaphoreHandle_t helper_done = nullptr;
static void helper_task(void*) {
  for (uint32_t l = 1; l < (uint32_t)lb::LEAVES; l += 2) {
    lb::leaf_hash(sk_seed, pub_seed, l, leaves[l]);
    __atomic_add_fetch(&leaves_done, 1, __ATOMIC_SEQ_CST);
    vTaskDelay(1);  // let core 0's idle task run (task watchdog)
  }
  xSemaphoreGive(helper_done);
  vTaskDelete(nullptr);
}

/** Computes all 256 leaf hashes into `leaves`, using both cores. Returns the time taken in ms. */
static uint32_t compute_leaves(const char* title) {
  uint32_t t0 = millis();
  leaves_done = 0;
  helper_done = xSemaphoreCreateBinary();
  xTaskCreatePinnedToCore(helper_task, "lb_leaves", 8192, nullptr, 1, nullptr, 0);
  char line[24];
  for (uint32_t l = 0; l < (uint32_t)lb::LEAVES; l += 2) {
    lb::leaf_hash(sk_seed, pub_seed, l, leaves[l], []() { yield(); });
    int d = __atomic_add_fetch(&leaves_done, 1, __ATOMIC_SEQ_CST);
    if (l % 16 == 0) {
      snprintf(line, sizeof line, "leaf %d/256", d);
      show(title, line, "2 cores", "do not unplug");
    }
  }
  xSemaphoreTake(helper_done, portMAX_DELAY);
  vSemaphoreDelete(helper_done);
  show(title, "leaf 256/256", "done");
  return millis() - t0;
}

/** Streams the public leaf hashes and root. Uses the cache in NVS when it's there (instant). */
static void stream_leaves_and_root(bool store) {
  bool cached = !store && prefs.getBytesLength("leaves") == sizeof leaves && prefs.getBytes("leaves", leaves, sizeof leaves) == sizeof leaves;
  if (!cached) {
    if (locked) return (void)Serial.println("WOTS|ERR|locked");  // recomputing the tree needs the seed
    uint32_t ms = compute_leaves(store ? "KEYGEN" : "TREE");
    prefs.putBytes("leaves", leaves, sizeof leaves);  // public data: cache it so the next export is instant
    Serial.print("WOTS|TIME|leaves|");
    Serial.println(ms);
  }
  for (uint32_t l = 0; l < (uint32_t)lb::LEAVES; l++) {
    Serial.print("WOTS|LH|");
    Serial.print(l);
    Serial.print("|");
    hexout(leaves[l], 32);
    Serial.println();
  }
  static uint8_t lvl[lb::LEAVES][32];  // 8 KB: static, the Arduino loop task's stack is only ~8 KB
  memcpy(lvl, leaves, sizeof lvl);
  for (int h = 1, n = lb::LEAVES; h <= lb::TREE_HEIGHT; h++, n /= 2)
    for (int i = 0; i < n / 2; i++) lb::node_hash(pub_seed, (uint8_t)h, (uint32_t)i, lvl[2 * i], lvl[2 * i + 1], lvl[i]);
  if (store) {
    memcpy(root, lvl[0], 32);
    prefs.putBytes("root", root, 32);
    prefs.putBool("keyok", true);
    have_key = true;
  }
  Serial.print("WOTS|ROOT|");
  hexout(lvl[0], 32);
  Serial.println();
}

static void cmd_keygen(const String& host_entropy_hex) {
  if (have_key) return (void)Serial.println("WOTS|ERR|key-exists");
  uint8_t host_entropy[32];
  if (!unhex(host_entropy_hex, host_entropy, 32)) return (void)Serial.println("WOTS|ERR|bad-entropy");
  // seeds = keccak(device RNG ‖ host entropy ‖ tag): neither side alone decides the key
  uint8_t buf[32 + 32 + 4];
  random_bytes(buf, 32);
  memcpy(buf + 32, host_entropy, 32);
  memcpy(buf + 64, "sk00", 4);
  lb::keccak256(buf, sizeof buf, sk_seed);
  random_bytes(buf, 32);
  memcpy(buf + 64, "pub0", 4);
  lb::keccak256(buf, sizeof buf, pub_seed);
  memset(buf, 0, sizeof buf);
  prefs.putBytes("sk", sk_seed, 32);
  prefs.putBytes("pub", pub_seed, 32);
  prefs.putUInt("next", 0);
  stream_leaves_and_root(true);
  show("KEY READY", "256 one-time keys", "next leaf 0");
}

static bool approve_pressed() { return digitalRead(PIN_APPROVE) == LOW || digitalRead(PIN_BOOT) == LOW; }

static const int PAGE_LINES = 5;
static int pages_of(const cs::Screen& sc) { return sc.n == 0 ? 1 : (sc.n + PAGE_LINES - 1) / PAGE_LINES; }

/** Page p of the request: title, 5 lines, and what the button does now. */
static void show_page(const cs::Screen& sc, int p, uint32_t leaf) {
  if (!oled_addr) return;
  int pages = pages_of(sc);
  oled.clear();
  oled.set2X();
  oled.println(sc.title);
  oled.set1X();
  for (int i = 0; i < PAGE_LINES; i++) {
    int k = p * PAGE_LINES + i;
    oled.println(k < sc.n ? sc.lines[k] : "");
  }
  char f[24];
  if (p == pages - 1) snprintf(f, sizeof f, "leaf %lu  BOOT=SIGN", (unsigned long)leaf);
  else snprintf(f, sizeof f, "%d/%d  BOOT=next page", p + 1, pages);
  oled.print(f);
}

/**
 * Shows the request page by page. BOOT moves to the next page; only on the last page does it approve, so every
 * line has been on screen before anything is signed. Returns 1 approved, -1 rejected (D19), 0 timeout.
 */
static int ask(const cs::Screen& sc, uint32_t leaf) {
  int pages = pages_of(sc), p = 0;
  show_page(sc, 0, leaf);
  uint32_t t0 = millis();
  while (approve_pressed() && millis() - t0 < 2000) delay(5);  // ignore a press that started before the request
  while (millis() - t0 < ASK_TIMEOUT_MS) {
    if (approve_pressed()) {
      delay(30);
      if (approve_pressed()) {
        if (p == pages - 1) return 1;
        while (approve_pressed()) delay(5);  // one press, one page
        show_page(sc, ++p, leaf);
      }
    }
    if (digitalRead(PIN_REJECT) == LOW) {
      delay(30);
      if (digitalRead(PIN_REJECT) == LOW) return -1;
    }
    delay(5);
  }
  return 0;
}


static bool hold_boot(uint32_t ms) {
  uint32_t t0 = millis();
  while (millis() - t0 < ms) {
    if (!approve_pressed()) return false;
    delay(10);
  }
  return true;
}

static void cmd_setpin(const String& hex) {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  if (locked) return (void)Serial.println("WOTS|ERR|locked");
  uint8_t p[pin::MAX_LEN];
  size_t n = 0;
  cs::Field f = {hex.c_str(), hex.length()};
  if (!cs::parse_hex(f, p, sizeof p, &n) || !pin::valid(p, n)) return (void)Serial.println("WOTS|ERR|pin-4-to-32-plain-characters");
  screen.reset(pin_set ? "NEW PIN?" : "SET PIN?");
  screen.add("The key will be stored");
  screen.add("encrypted. After power");
  screen.add("-on it stays locked");
  screen.add("until the PIN is given.");
  int b = ask(screen, next_leaf());
  if (b <= 0) {
    memset(p, 0, sizeof p);
    show_idle();
    return (void)Serial.println(b < 0 ? "WOTS|ERR|rejected" : "WOTS|ERR|timeout");
  }
  show("SETTING PIN", "stretching the PIN", "a few seconds");
  uint8_t salt[16], key[32], tag[8], skx[32];
  random_bytes(salt, 16);
  pin::derive(p, n, salt, key, []() { yield(); });
  pin::check_tag(key, tag);
  memcpy(skx, sk_seed, 32);
  pin::xor_seed(key, skx);
  prefs.putBytes("skx", skx, 32);
  prefs.putBytes("salt", salt, 16);
  prefs.putBytes("kchk", tag, 8);
  prefs.putUInt("pinfails", 0);
  // the encrypted copy must decrypt back before the plaintext copy goes
  uint8_t back[32];
  bool ok = prefs.getBytes("skx", back, 32) == 32;
  pin::xor_seed(key, back);
  ok = ok && memcmp(back, sk_seed, 32) == 0;
  memset(back, 0, sizeof back);
  memset(key, 0, sizeof key);
  memset(p, 0, sizeof p);
  if (!ok) {
    show("ERROR", "PIN not set", "key unchanged");
    return (void)Serial.println("WOTS|ERR|persist");
  }
  prefs.putBool("pinset", true);
  prefs.remove("sk");
  pin_set = true;
  locked = false;
  show_idle();
  Serial.println("WOTS|PINSET");
}

static void cmd_unlock(const String& hex) {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  if (!pin_set) return (void)Serial.println("WOTS|ERR|no-pin");
  if (!locked) return (void)Serial.println("WOTS|UNLOCKED");
  uint8_t p[pin::MAX_LEN];
  size_t n = 0;
  cs::Field f = {hex.c_str(), hex.length()};
  if (!cs::parse_hex(f, p, sizeof p, &n) || !pin::valid(p, n)) return (void)Serial.println("WOTS|ERR|bad-pin-format");
  uint32_t fails = prefs.getUInt("pinfails", 0);
  for (uint32_t i = pin::backoff_seconds(fails); i > 0; i--) {  // enforced here; the count survives a reboot
    char l2[24];
    snprintf(l2, sizeof l2, "wait %lu s", (unsigned long)i);
    show("LOCKED", "too many wrong PINs", l2);
    delay(1000);
  }
  show("UNLOCKING", "stretching the PIN", "a few seconds");
  uint8_t salt[16], key[32], tag[8], want[8];
  prefs.getBytes("salt", salt, 16);
  prefs.getBytes("kchk", want, 8);
  pin::derive(p, n, salt, key, []() { yield(); });
  memset(p, 0, sizeof p);
  pin::check_tag(key, tag);
  if (memcmp(tag, want, 8) != 0) {
    memset(key, 0, sizeof key);
    prefs.putUInt("pinfails", fails + 1);
    char l2[24];
    snprintf(l2, sizeof l2, "%lu wrong in a row", (unsigned long)(fails + 1));
    show("WRONG PIN", l2, "still locked");
    Serial.print("WOTS|ERR|bad-pin|");
    return (void)Serial.println(fails + 1);
  }
  prefs.getBytes("skx", sk_seed, 32);
  pin::xor_seed(key, sk_seed);
  memset(key, 0, sizeof key);
  prefs.putUInt("pinfails", 0);
  locked = false;
  show_idle();
  Serial.println("WOTS|UNLOCKED");
}

static void cmd_lock() {
  if (!pin_set) return (void)Serial.println("WOTS|ERR|no-pin");
  memset(sk_seed, 0, sizeof sk_seed);
  locked = true;
  show_idle();
  Serial.println("WOTS|LOCKED");
}

/** Erases the key for good. Needs BOOT held for 5 s within 30 s of the request. */
static void cmd_wipe() {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  show("WIPE KEY?", "hold BOOT 5 s to", "erase it for good", "else wait 30 s");
  uint32_t t0 = millis();
  while (approve_pressed() && millis() - t0 < 2000) delay(5);  // a press that started before the request doesn't count
  bool held = false;
  while (!held && millis() - t0 < 30000) {
    if (approve_pressed() && hold_boot(5000)) held = true;
    delay(10);
  }
  if (!held) {
    show_idle();
    return (void)Serial.println("WOTS|ERR|timeout");
  }
  for (const char* k : {"sk", "skx", "salt", "kchk", "pinset", "pinfails", "pub", "root", "leaves", "keyok"}) prefs.remove(k);
  prefs.putUInt("next", 0);
  memset(sk_seed, 0, sizeof sk_seed);
  have_key = pin_set = locked = false;
  show("WIPED", "the key is gone");
  Serial.println("WOTS|WIPED");
}

static void cmd_request(const String& line) {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  if (locked) {
    show("LOCKED", "enter the PIN", "on the laptop first", "nothing signed");
    return (void)Serial.println("WOTS|ERR|locked");
  }
  uint32_t leaf = next_leaf();
  if (leaf >= (uint32_t)lb::LEAVES) return (void)Serial.println("WOTS|ERR|exhausted");
  uint8_t sig_hash[32];
  uint32_t counter = 0;
  // the hash comes from the request's own fields, never from the host
  const char* err = cs::build_request(line.c_str(), line.length(), screen, sig_hash, &counter, leaf);
  if (err) {
    Serial.print("WOTS|ERR|");
    return (void)Serial.println(err);
  }
  if (screen.truncated) return (void)Serial.println("WOTS|ERR|too-long-to-show");
  // check the counter BEFORE asking or spending anything (no secret needed)
  uint8_t digest[32], digits[lb::LEN];
  lb::message_digest(pub_seed, leaf, root, sig_hash, counter, digest);
  if (lb::digits_of(digest, digits) != lb::TARGET_SUM) return (void)Serial.println("WOTS|ERR|bad-counter");

  Serial.print("WOTS|HASH|");
  hexout(sig_hash, 32);
  Serial.println();
  Serial.print("WOTS|ASK|");
  Serial.println(leaf);
  int b = ask(screen, leaf);
  if (b <= 0) {
    show(b < 0 ? "REJECTED" : "TIMEOUT", "nothing signed", "no leaf used");
    return (void)Serial.println(b < 0 ? "WOTS|ERR|rejected" : "WOTS|ERR|timeout");
  }
  // persist-before-release: the leaf is burned even if power fails mid-signature
  prefs.putUInt("next", leaf + 1);
  if (next_leaf() != leaf + 1) {
    show("ERROR", "counter not saved");
    return (void)Serial.println("WOTS|ERR|persist");
  }
  char l2[24];
  snprintf(l2, sizeof l2, "leaf %lu", (unsigned long)leaf);
  show("SIGNING", screen.title, l2);
  if (!lb::sign_chains(sk_seed, pub_seed, root, leaf, sig_hash, counter, sigs)) return (void)Serial.println("WOTS|ERR|bad-counter");
  for (int k = 0; k < lb::LEN; k++) {
    Serial.print("WOTS|SIG|");
    Serial.print(k + 1);
    Serial.print("/64|");
    hexout(sigs[k], 32);
    Serial.println();
  }
  uint8_t h[32];
  lb::keccak256(&sigs[0][0], sizeof sigs, h);
  memset(sigs, 0, sizeof sigs);
  Serial.print("WOTS|DONE|");
  Serial.print(leaf);
  Serial.print("|");
  hexout(h, 32);
  Serial.println();
  char l4[24];
  snprintf(l4, sizeof l4, "next leaf %lu", (unsigned long)(leaf + 1));
  show("SIGNED", screen.title, "leaf burned", l4);
}

/** Times one core vs both, on the real key's (public) leaves. Touches no secret state and no counter. */
static void cmd_bench() {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  if (locked) return (void)Serial.println("WOTS|ERR|locked");
  uint8_t tmp[32];
  uint32_t t0 = millis();
  for (uint32_t l = 0; l < 8; l++) lb::leaf_hash(sk_seed, pub_seed, l, tmp, []() { yield(); });
  uint32_t single_est = (millis() - t0) * (lb::LEAVES / 8);
  uint32_t dual = compute_leaves("BENCH");
  Serial.print("WOTS|BENCH|single_core_est_ms|");
  Serial.print(single_est);
  Serial.print("|dual_core_ms|");
  Serial.println(dual);
  show_idle();
}

static void cmd_efuse() {
#ifdef LB_HAVE_EFUSE
  esp_efuse_coding_scheme_t cs = esp_efuse_get_coding_scheme(EFUSE_BLK3);
  Serial.print("WOTS|EFUSE|");
  Serial.println(cs == EFUSE_CODING_SCHEME_NONE ? "NONE" : cs == EFUSE_CODING_SCHEME_3_4 ? "3/4" : "RS");
#else
  Serial.println("WOTS|EFUSE|unavailable");
#endif
}

void setup() {
  Serial.setRxBufferSize(8192);  // a request line can be a few KB (hex)
  Serial.begin(115200);
  Serial.setTimeout(2000);
  pinMode(PIN_APPROVE, INPUT_PULLUP);
  pinMode(PIN_REJECT, INPUT_PULLUP);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  Serial.println("WOTS|BOOT");
  Wire.begin(21, 22);
  Wire.setClock(100000L);  // 100 kHz: more forgiving of long breadboard wires
  Wire.setTimeOut(30);     // ms: a stuck bus fails fast instead of stalling
  scan_i2c();  // finds the screen at 0x3C or 0x3D and reports it over serial
  prefs.begin("lifeboat", false);
  load_key();
  char l2[24];
  snprintf(l2, sizeof l2, have_key ? "next leaf %lu" : "no key yet", (unsigned long)next_leaf());
  show("LIFEBOAT", "post-quantum signer", l2);
  Serial.print("WOTS|HELLO|");
  Serial.print(next_leaf());
  Serial.println(have_key ? "|KEY" : "|NOKEY");
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.startsWith("WOTS|")) return;
  int p1 = line.indexOf('|', 5);
  String cmd = p1 < 0 ? line.substring(5) : line.substring(5, p1);
  String rest = p1 < 0 ? "" : line.substring(p1 + 1);
  if (cmd == "PING") Serial.println("WOTS|PONG");
  else if (cmd == "INFO") {
    if (!have_key) Serial.println("WOTS|INFO|NOKEY");
    else {
      Serial.print("WOTS|INFO|");
      Serial.print(next_leaf());
      Serial.print("|");
      hexout(pub_seed, 32);
      Serial.print("|");
      hexout(root, 32);
      Serial.print(pin_set ? "|pin=1" : "|pin=0");
      Serial.println(locked ? "|locked=1" : "|locked=0");
    }
  } else if (cmd == "KEYGEN") cmd_keygen(rest);
  else if (cmd == "SETPIN") cmd_setpin(rest);
  else if (cmd == "UNLOCK") cmd_unlock(rest);
  else if (cmd == "LOCK") cmd_lock();
  else if (cmd == "WIPE") cmd_wipe();
  else if (cmd == "LEAVES") {
    if (have_key) {
      stream_leaves_and_root(false);
      show_idle();
    }
    else Serial.println("WOTS|ERR|no-key");
  } else if (cmd == "MSG" || cmd == "PQW" || cmd == "SAFE" || cmd == "FRAME") cmd_request(line);
  else if (cmd == "SIGN") {
    show("REFUSED", "a bare hash can't", "be shown in words:", "nothing signed");
    Serial.println("WOTS|ERR|blind-signing-off");
  } else if (cmd == "EFUSE") cmd_efuse();
  else if (cmd == "BENCH") cmd_bench();
  else if (cmd == "PINSCAN") pin_scan();
  else if (cmd == "LINES") line_test();
  else if (cmd == "I2C") {
    scan_i2c();
    show_idle();
  }
  else Serial.println("WOTS|ERR|unknown");
}
