// WOTS+C signer core. Must match packages/pq/src/params.ts + hash.ts byte for byte:
//   n = 32, w = 16, 64 chains, TARGET_SUM 560, tree height 8 (256 leaves)
//   tweak = pubSeed[0:24] ‖ idx (u32 BE) ‖ a ‖ b ‖ type ‖ 0x00
// The device only does what needs the secret: derive chain starts and walk them to the digest digits.
// It recomputes the digest itself and refuses a counter whose digits don't sum to TARGET_SUM.
#pragma once
#include "keccak.h"

namespace lb {

static const int LEN = 64;
static const int MAX_STEP = 15;
static const int TARGET_SUM = 560;
static const int TREE_HEIGHT = 8;
static const int LEAVES = 1 << TREE_HEIGHT;
enum : uint8_t { T_CHAIN = 0, T_LEAF = 1, T_NODE = 2, T_MSG = 3, T_SK = 4 };

static void write_adrs(uint8_t* out, const uint8_t pub_seed[32], uint32_t idx, uint8_t a, uint8_t b, uint8_t type) {
  memcpy(out, pub_seed, 24);
  out[24] = (uint8_t)(idx >> 24);
  out[25] = (uint8_t)(idx >> 16);
  out[26] = (uint8_t)(idx >> 8);
  out[27] = (uint8_t)idx;
  out[28] = a;
  out[29] = b;
  out[30] = type;
  out[31] = 0;
}

/** Applies chain steps from..to-1 to x (in place). */
static void chain(const uint8_t pub_seed[32], uint32_t leaf, uint8_t chain_idx, uint8_t x[32], int from, int to) {
  uint8_t buf[64];
  write_adrs(buf, pub_seed, leaf, chain_idx, 0, T_CHAIN);
  for (int j = from; j < to; j++) {
    buf[29] = (uint8_t)j;
    memcpy(buf + 32, x, 32);
    keccak256(buf, 64, x);
  }
}

/** sk_i = keccak(skSeed ‖ adrs(leaf, i, 0, SK)) */
static void secret_chain_start(const uint8_t sk_seed[32], const uint8_t pub_seed[32], uint32_t leaf, uint8_t chain_idx, uint8_t out[32]) {
  uint8_t buf[64];
  memcpy(buf, sk_seed, 32);
  write_adrs(buf + 32, pub_seed, leaf, chain_idx, 0, T_SK);
  keccak256(buf, 64, out);
}

/** Leaf hash: keccak(adrs(leaf,0,0,LEAF) ‖ pk_0 ‖ … ‖ pk_63). ~960 chain hashes. yield() is called between chains. */
static void leaf_hash(const uint8_t sk_seed[32], const uint8_t pub_seed[32], uint32_t leaf, uint8_t out[32], void (*yield_fn)() = nullptr) {
  static uint8_t buf[32 + LEN * 32];
  write_adrs(buf, pub_seed, leaf, 0, 0, T_LEAF);
  for (int i = 0; i < LEN; i++) {
    uint8_t x[32];
    secret_chain_start(sk_seed, pub_seed, leaf, (uint8_t)i, x);
    chain(pub_seed, leaf, (uint8_t)i, x, 0, MAX_STEP);
    memcpy(buf + 32 + 32 * i, x, 32);
    if (yield_fn) yield_fn();
  }
  keccak256(buf, sizeof buf, out);
}

static void node_hash(const uint8_t pub_seed[32], uint8_t level, uint32_t idx, const uint8_t left[32], const uint8_t right[32], uint8_t out[32]) {
  uint8_t buf[96];
  write_adrs(buf, pub_seed, idx, level, 0, T_NODE);
  memcpy(buf + 32, left, 32);
  memcpy(buf + 64, right, 32);
  keccak256(buf, 96, out);
}

/** digest = keccak(adrs(leaf,0,0,MSG) ‖ root ‖ sigHash ‖ uint256(counter)) */
static void message_digest(const uint8_t pub_seed[32], uint32_t leaf, const uint8_t root[32], const uint8_t sig_hash[32], uint32_t counter, uint8_t out[32]) {
  uint8_t buf[128];
  write_adrs(buf, pub_seed, leaf, 0, 0, T_MSG);
  memcpy(buf + 32, root, 32);
  memcpy(buf + 64, sig_hash, 32);
  memset(buf + 96, 0, 28);
  buf[124] = (uint8_t)(counter >> 24);
  buf[125] = (uint8_t)(counter >> 16);
  buf[126] = (uint8_t)(counter >> 8);
  buf[127] = (uint8_t)counter;
  keccak256(buf, 128, out);
}

static int digits_of(const uint8_t digest[32], uint8_t digits[LEN]) {
  int sum = 0;
  for (int i = 0; i < 32; i++) {
    digits[2 * i] = digest[i] >> 4;
    digits[2 * i + 1] = digest[i] & 0x0f;
    sum += digits[2 * i] + digits[2 * i + 1];
  }
  return sum;
}

/** Signs: fills sigs[64][32]. Returns false (and writes nothing) if the digest digits don't sum to TARGET_SUM. */
static bool sign_chains(const uint8_t sk_seed[32], const uint8_t pub_seed[32], const uint8_t root[32], uint32_t leaf, const uint8_t sig_hash[32], uint32_t counter, uint8_t sigs[LEN][32]) {
  uint8_t digest[32], digits[LEN];
  message_digest(pub_seed, leaf, root, sig_hash, counter, digest);
  if (digits_of(digest, digits) != TARGET_SUM) return false;
  for (int i = 0; i < LEN; i++) {
    secret_chain_start(sk_seed, pub_seed, leaf, (uint8_t)i, sigs[i]);
    chain(pub_seed, leaf, (uint8_t)i, sigs[i], 0, digits[i]);
  }
  return true;
}

}  // namespace lb
