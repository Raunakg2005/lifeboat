// PIN lock: the secret seed is stored encrypted, and the device stays locked after power-on until the PIN is entered.
//   key  = keccak^ROUNDS(salt ‖ pin), stretched on the device (a few seconds per try)
//   tag  = keccak(key ‖ "lifeboat-pin-check")[0:8]   (checks the PIN without decrypting)
//   pad  = keccak(key ‖ "lifeboat-seed-pad")         (one 32-byte seed per key; a new random salt on every SETPIN)
//   skx  = sk ⊕ pad
// What it protects: a lost or stolen device, or a copy of its flash, needs the PIN before it can sign.
// What it doesn't: a determined attacker with the flash can still guess short PINs offline. Production adds the
// ESP32's flash encryption (a hardware key that never leaves the chip), see docs/hardware.md.
// No Arduino dependencies, so tools/firmware-check.mjs runs it on the host.
#pragma once
#include <stdint.h>
#include <string.h>
#include "keccak.h"

namespace pin {

static const uint32_t ROUNDS = 20000;
static const size_t MIN_LEN = 4, MAX_LEN = 32;

static void derive(const uint8_t* p, size_t n, const uint8_t salt[16], uint8_t key[32], void (*yield_fn)() = nullptr) {
  uint8_t buf[16 + MAX_LEN];
  memcpy(buf, salt, 16);
  memcpy(buf + 16, p, n);
  lb::keccak256(buf, 16 + n, key);
  uint8_t k2[48];
  for (uint32_t i = 1; i < ROUNDS; i++) {
    memcpy(k2, key, 32);
    memcpy(k2 + 32, salt, 16);
    lb::keccak256(k2, 48, key);
    if (yield_fn && (i & 1023) == 0) yield_fn();
  }
  memset(buf, 0, sizeof buf);
  memset(k2, 0, sizeof k2);
}

static void tagged(const uint8_t key[32], const char* label, uint8_t out[32]) {
  uint8_t buf[32 + 24];
  size_t n = strlen(label);
  memcpy(buf, key, 32);
  memcpy(buf + 32, label, n);
  lb::keccak256(buf, 32 + n, out);
  memset(buf, 0, sizeof buf);
}

static void check_tag(const uint8_t key[32], uint8_t tag[8]) {
  uint8_t h[32];
  tagged(key, "lifeboat-pin-check", h);
  memcpy(tag, h, 8);
}

/** In place: encrypts or decrypts the 32-byte seed (XOR with the key's pad). */
static void xor_seed(const uint8_t key[32], uint8_t seed[32]) {
  uint8_t pad[32];
  tagged(key, "lifeboat-seed-pad", pad);
  for (int i = 0; i < 32; i++) seed[i] ^= pad[i];
  memset(pad, 0, sizeof pad);
}

static bool valid(const uint8_t* p, size_t n) {
  if (n < MIN_LEN || n > MAX_LEN) return false;
  for (size_t i = 0; i < n; i++)
    if (p[i] < 0x20 || p[i] > 0x7e) return false;
  return true;
}

/** Seconds to wait before a PIN try, after `fails` wrong ones in a row (kept across reboots). */
static uint32_t backoff_seconds(uint32_t fails) {
  if (fails < 3) return 0;
  uint32_t s = 5u << (fails - 3 > 7 ? 7 : fails - 3);  // 5, 10, 20, … capped at 640 s
  return s;
}

}  // namespace pin
