// Keccak-256 (Ethereum's keccak: pad byte 0x01, not SHA3's 0x06). Portable C++, no dependencies,
// so the same file runs on the ESP32 and in the host test (firmware/esp32/test).
#pragma once
// Hashing dominates keygen time: build it for speed even when the sketch is built for size (-Os).
#pragma GCC optimize("O3")
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace lb {

static const uint64_t KECCAK_RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};
static const uint8_t KECCAK_ROT[24] = {1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44};
static const uint8_t KECCAK_PI[24] = {10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1};

static inline uint64_t rotl64(uint64_t x, unsigned n) { return (x << n) | (x >> (64 - n)); }

static void keccak_f1600(uint64_t s[25]) {
  uint64_t bc[5];
  for (int round = 0; round < 24; round++) {
    // theta
    for (int i = 0; i < 5; i++) bc[i] = s[i] ^ s[i + 5] ^ s[i + 10] ^ s[i + 15] ^ s[i + 20];
    for (int i = 0; i < 5; i++) {
      uint64_t t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (int j = 0; j < 25; j += 5) s[j + i] ^= t;
    }
    // rho + pi
    uint64_t t = s[1];
    for (int i = 0; i < 24; i++) {
      int j = KECCAK_PI[i];
      uint64_t tmp = s[j];
      s[j] = rotl64(t, KECCAK_ROT[i]);
      t = tmp;
    }
    // chi
    for (int j = 0; j < 25; j += 5) {
      for (int i = 0; i < 5; i++) bc[i] = s[j + i];
      for (int i = 0; i < 5; i++) s[j + i] ^= (~bc[(i + 1) % 5]) & bc[(i + 2) % 5];
    }
    // iota
    s[0] ^= KECCAK_RC[round];
  }
}

/** keccak256(in[0..len)) -> out[32] */
static void keccak256(const uint8_t* in, size_t len, uint8_t out[32]) {
  const size_t rate = 136;
  uint64_t s[25];
  memset(s, 0, sizeof s);
  uint8_t block[136];
  while (len >= rate) {
    for (size_t i = 0; i < rate / 8; i++) {
      uint64_t lane = 0;
      for (int b = 7; b >= 0; b--) lane = (lane << 8) | in[i * 8 + b];
      s[i] ^= lane;
    }
    keccak_f1600(s);
    in += rate;
    len -= rate;
  }
  memset(block, 0, rate);
  memcpy(block, in, len);
  block[len] ^= 0x01;
  block[rate - 1] ^= 0x80;
  for (size_t i = 0; i < rate / 8; i++) {
    uint64_t lane = 0;
    for (int b = 7; b >= 0; b--) lane = (lane << 8) | block[i * 8 + b];
    s[i] ^= lane;
  }
  keccak_f1600(s);
  for (int i = 0; i < 32; i++) out[i] = (uint8_t)(s[i / 8] >> (8 * (i % 8)));
}

}  // namespace lb
