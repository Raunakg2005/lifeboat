// Host test for the firmware's crypto core (no Arduino). Prints, for the seeds used by the TypeScript
// vectors (skSeed = 0x11…, pubSeed = 0x22…): keccak256("") and the Merkle root, then the 64 chain values
// for one (leaf, sigHash, counter). tools/firmware-check.mjs compares them with contracts/test/vectors/wots.json.
//   g++ -O2 -std=c++17 -I ../lifeboat_signer host_test.cpp -o host_test && ./host_test <leaf> <sigHashHex> <counter>
// Clear signing: ./host_test requests  < lines of "<deviceLeaf> <request line>"  prints, per case, the error or the
// hash the device computed and the screen lines (clear.h, the same code the firmware runs).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "wots.h"
#include "clear.h"
#include "pin.h"
#include <iostream>
#include <string>

static void hex(const uint8_t* b, size_t n) {
  for (size_t i = 0; i < n; i++) printf("%02x", b[i]);
}
static void unhex(const char* s, uint8_t* out, size_t n) {
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  for (size_t i = 0; i < n; i++) sscanf(s + 2 * i, "%2hhx", &out[i]);
}

static int run_requests() {
  std::string in;
  int i = 0;
  static cs::Screen sc;
  while (std::getline(std::cin, in)) {
    size_t sp = in.find(' ');
    if (sp == std::string::npos) continue;
    uint32_t leaf = (uint32_t)strtoul(in.substr(0, sp).c_str(), nullptr, 10);
    std::string line = in.substr(sp + 1);
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
    uint8_t h[32];
    uint32_t counter = 0;
    const char* err = cs::build_request(line.c_str(), line.size(), sc, h, &counter, leaf);
    printf("case%d.err=%s\n", i, err ? err : "");
    if (!err) {
      printf("case%d.hash=", i);
      hex(h, 32);
      printf("\ncase%d.title=%s\ncase%d.truncated=%d\n", i, sc.title, i, sc.truncated ? 1 : 0);
      for (int k = 0; k < sc.n; k++) printf("case%d.line%d=%s\n", i, k, sc.lines[k]);
    }
    i++;
  }
  return 0;
}

static int run_pin() {
  // seal a seed with a PIN, open it with the right PIN, and check a wrong PIN is told apart (tag) and decrypts to junk
  uint8_t seed[32], sealed[32], salt[16], key[32], tag[8], tag2[8];
  for (int i = 0; i < 32; i++) seed[i] = (uint8_t)(i * 7 + 1);
  for (int i = 0; i < 16; i++) salt[i] = (uint8_t)(0xa0 + i);
  const char* good = "harbour-2026";
  const char* bad = "harbour-2027";
  pin::derive((const uint8_t*)good, strlen(good), salt, key);
  pin::check_tag(key, tag);
  memcpy(sealed, seed, 32);
  pin::xor_seed(key, sealed);
  printf("pin.sealed_differs=%d\n", memcmp(sealed, seed, 32) != 0 ? 1 : 0);
  uint8_t opened[32];
  memcpy(opened, sealed, 32);
  pin::derive((const uint8_t*)good, strlen(good), salt, key);
  pin::xor_seed(key, opened);
  printf("pin.roundtrip=%d\n", memcmp(opened, seed, 32) == 0 ? 1 : 0);
  pin::derive((const uint8_t*)bad, strlen(bad), salt, key);
  pin::check_tag(key, tag2);
  printf("pin.wrong_pin_refused=%d\n", memcmp(tag, tag2, 8) != 0 ? 1 : 0);
  printf("pin.short_pin_refused=%d\n", pin::valid((const uint8_t*)"123", 3) ? 0 : 1);
  printf("pin.backoff=%u,%u,%u,%u\n", pin::backoff_seconds(2), pin::backoff_seconds(3), pin::backoff_seconds(5), pin::backoff_seconds(30));
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && !strcmp(argv[1], "pin")) return run_pin();
  if (argc > 1 && !strcmp(argv[1], "requests")) return run_requests();
  uint8_t empty[32];
  lb::keccak256(nullptr, 0, empty);
  printf("keccak256_empty=");
  hex(empty, 32);
  printf("\n");

  uint8_t sk[32], pub[32];
  memset(sk, 0x11, 32);
  memset(pub, 0x22, 32);
  static uint8_t level[lb::LEAVES][32];
  for (uint32_t l = 0; l < (uint32_t)lb::LEAVES; l++) lb::leaf_hash(sk, pub, l, level[l]);
  for (int h = 1, n = lb::LEAVES; h <= lb::TREE_HEIGHT; h++, n /= 2)
    for (int i = 0; i < n / 2; i++) lb::node_hash(pub, (uint8_t)h, (uint32_t)i, level[2 * i], level[2 * i + 1], level[i]);
  printf("root=");
  hex(level[0], 32);
  printf("\n");
  if (argc < 4) return 0;

  uint8_t root[32];
  memcpy(root, level[0], 32);
  uint32_t leaf = (uint32_t)strtoul(argv[1], nullptr, 10);
  uint8_t sig_hash[32];
  unhex(argv[2], sig_hash, 32);
  uint32_t counter = (uint32_t)strtoul(argv[3], nullptr, 10);
  static uint8_t sigs[lb::LEN][32];
  bool ok = lb::sign_chains(sk, pub, root, leaf, sig_hash, counter, sigs);
  printf("sign_ok=%d\nsigs=", ok ? 1 : 0);
  if (ok) hex(&sigs[0][0], sizeof sigs);
  printf("\n");
  // a wrong counter must be refused
  printf("wrong_counter_refused=%d\n", lb::sign_chains(sk, pub, root, leaf, sig_hash, counter + 1, sigs) ? 0 : 1);
  return 0;
}
