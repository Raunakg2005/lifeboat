// Lifeboat hardware signer for ESP32 DevKit V1 (Arduino core).
//
// Holds the WOTS+C secret seed and the leaf counter; nothing secret ever leaves the device.
//   - the host (laptop/browser) grinds the counter and holds the public Merkle tree (no secret needed)
//   - the device picks the leaf from its own counter, recomputes the digest itself, refuses a bad counter,
//     shows the request on the OLED, waits for the physical Approve button, PERSISTS the counter, and only then
//     computes and streams the 64 chain values
//
// Wiring (3.3 V): OLED SSD1306 SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND
//                 Approve button GPIO32 -> GND, Reject button GPIO33 -> GND (internal pull-ups)
// Serial: 115200 baud, line protocol, every line starts with "WOTS|" (the host ignores anything else):
//   WOTS|PING                          -> WOTS|PONG
//   WOTS|INFO                          -> WOTS|INFO|<nextLeaf>|<pubSeed>|<root>   or  WOTS|INFO|NOKEY
//   WOTS|KEYGEN|<hostEntropy hex32>    -> WOTS|LH|<i>|<leafHash> x256, then WOTS|ROOT|<root>
//   WOTS|LEAVES                        -> re-streams WOTS|LH lines (public; ~40 s), then WOTS|ROOT
//   WOTS|SIGN|<sigHash>|<counter>|<label>
//        -> WOTS|ASK|<leaf>  (waits for a button) -> WOTS|SIG|<k>/64|<chain value> x64 -> WOTS|DONE|<leaf>|<keccak of sigs>
//        or WOTS|ERR|<reason>
//   WOTS|EFUSE                         -> WOTS|EFUSE|<coding scheme of BLOCK3> (read-only, never burns)
// Libraries: SSD1306Ascii (Bill Greiman). Preferences is built into the ESP32 core.
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include "SSD1306Ascii.h"
#include "SSD1306AsciiWire.h"
#include "wots.h"
#if __has_include("bootloader_random.h")
#include "bootloader_random.h"
#define LB_HAVE_BOOTLOADER_RANDOM 1
#endif
#if __has_include("esp_efuse.h")
#include "esp_efuse.h"
#define LB_HAVE_EFUSE 1
#endif

static const int PIN_APPROVE = 32;
static const int PIN_REJECT = 33;
static const uint32_t ASK_TIMEOUT_MS = 60000;

Preferences prefs;
SSD1306AsciiWire oled;
static bool have_key = false;
static uint8_t sk_seed[32], pub_seed[32], root[32];
static uint8_t leaves[lb::LEAVES][32];  // public, only needed during keygen / re-export
static uint8_t sigs[lb::LEN][32];

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

static void stream_leaves_and_root(bool store) {
  char line[24];
  for (uint32_t l = 0; l < (uint32_t)lb::LEAVES; l++) {
    lb::leaf_hash(sk_seed, pub_seed, l, leaves[l], []() { yield(); });
    Serial.print("WOTS|LH|");
    Serial.print(l);
    Serial.print("|");
    hexout(leaves[l], 32);
    Serial.println();
    if (l % 8 == 0) {
      snprintf(line, sizeof line, "leaf %lu/256", (unsigned long)l);
      show("KEYGEN", line, "do not unplug");
    }
  }
  uint8_t lvl[lb::LEAVES][32];
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

static int wait_button() {
  uint32_t t0 = millis();
  while (millis() - t0 < ASK_TIMEOUT_MS) {
    if (digitalRead(PIN_APPROVE) == LOW) {
      delay(30);
      if (digitalRead(PIN_APPROVE) == LOW) return 1;
    }
    if (digitalRead(PIN_REJECT) == LOW) {
      delay(30);
      if (digitalRead(PIN_REJECT) == LOW) return -1;
    }
    delay(5);
  }
  return 0;
}

static void cmd_sign(const String& sig_hash_hex, uint32_t counter, const String& label) {
  if (!have_key) return (void)Serial.println("WOTS|ERR|no-key");
  uint8_t sig_hash[32];
  if (!unhex(sig_hash_hex, sig_hash, 32)) return (void)Serial.println("WOTS|ERR|bad-sighash");
  uint32_t leaf = next_leaf();
  if (leaf >= (uint32_t)lb::LEAVES) return (void)Serial.println("WOTS|ERR|exhausted");
  // check the counter BEFORE asking or spending anything (no secret needed)
  uint8_t digest[32], digits[lb::LEN];
  lb::message_digest(pub_seed, leaf, root, sig_hash, counter, digest);
  if (lb::digits_of(digest, digits) != lb::TARGET_SUM) return (void)Serial.println("WOTS|ERR|bad-counter");

  char l2[32], l3[32];
  snprintf(l2, sizeof l2, "leaf %lu  tx %c%c%c%c..%c%c%c%c", (unsigned long)leaf, sig_hash_hex[2], sig_hash_hex[3], sig_hash_hex[4], sig_hash_hex[5], sig_hash_hex[62], sig_hash_hex[63], sig_hash_hex[64], sig_hash_hex[65]);
  snprintf(l3, sizeof l3, "%.21s", label.c_str());
  show("SIGN?", l2, l3, "32=yes  33=no");
  Serial.print("WOTS|ASK|");
  Serial.println(leaf);
  int b = wait_button();
  if (b <= 0) {
    show(b < 0 ? "REJECTED" : "TIMEOUT", "nothing signed");
    return (void)Serial.println(b < 0 ? "WOTS|ERR|rejected" : "WOTS|ERR|timeout");
  }
  // persist-before-release: the leaf is burned even if power fails mid-signature
  prefs.putUInt("next", leaf + 1);
  if (next_leaf() != leaf + 1) {
    show("ERROR", "counter not saved");
    return (void)Serial.println("WOTS|ERR|persist");
  }
  show("SIGNING", l2);
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
  show("SIGNED", l2, "leaf burned", l4);
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
  Serial.begin(115200);
  pinMode(PIN_APPROVE, INPUT_PULLUP);
  pinMode(PIN_REJECT, INPUT_PULLUP);
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
    if (have_key) stream_leaves_and_root(false);
    else Serial.println("WOTS|ERR|no-key");
  } else if (cmd == "SIGN") {
    int a = rest.indexOf('|');
    int b = rest.indexOf('|', a + 1);
    if (a < 0) return (void)Serial.println("WOTS|ERR|usage");
    String sh = rest.substring(0, a);
    uint32_t counter = (uint32_t)strtoul(rest.substring(a + 1, b < 0 ? rest.length() : b).c_str(), nullptr, 10);
    cmd_sign(sh, counter, b < 0 ? String("") : rest.substring(b + 1));
  } else if (cmd == "EFUSE") cmd_efuse();
  else Serial.println("WOTS|ERR|unknown");
}
