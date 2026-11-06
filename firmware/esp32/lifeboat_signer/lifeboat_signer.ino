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
//   WOTS|EFUSE                         -> WOTS|EFUSE|<coding scheme of BLOCK3> (read-only, never burns)
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
static void show(const char* l1, const char* l2 = "", const char* l3 = "", const char* l4 = "") {
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
  show("LIFEBOAT", "post-quantum signer", l3, have_key ? "clear signing on" : "");
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
  have_key = prefs.getBool("keyok", false) && prefs.getBytes("sk", sk_seed, 32) == 32 && prefs.getBytes("pub", pub_seed, 32) == 32 && prefs.getBytes("root", root, 32) == 32;
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

static void cmd_request(const String& line) {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
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
  Wire.begin(21, 22);
  Wire.setClock(400000L);
  oled.begin(&Adafruit128x64, 0x3C);
  oled.setFont(System5x7);
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
      Serial.println();
    }
  } else if (cmd == "KEYGEN") cmd_keygen(rest);
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
  else Serial.println("WOTS|ERR|unknown");
}
