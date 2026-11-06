// Clear signing. The device never signs a bare hash: the host sends the request's own fields, and the device
// rebuilds the hash it signs from them and turns the same bytes into lines of plain text for the screen. What the
// person approves on the screen is exactly what gets signed.
//
// Request lines (counter = the host's ground WOTS+C counter; integers decimal, amounts and bytes hex):
//   WOTS|MSG|<counter>|<text hex>
//        sigHash = keccak("\x19Lifeboat Signed Message:\n" ‖ len ‖ text), printable ASCII only
//   WOTS|PQW|<counter>|<chainId>|<wallet>|<leaf>|<deadline>|<abi.encode(Call[]) hex>
//        LifeboatPQWallet.digest: keccak(abi.encode("LIFEBOAT_PQ_V1", chainId, wallet, leaf, deadline, keccak(calls)))
//   WOTS|SAFE|<counter>|<chainId>|<guard>|<safe>|<to>|<value>|<data>|<op>|<safeTxGas>|<baseGas>|<gasPrice>|<gasToken>|<refundReceiver>|<nonce>
//        Quantum Guard co-signature: keccak(abi.encode("LIFEBOAT_QUANTUM_GUARD_V1", 0, chainId, guard, safe, safeTxHash))
//   WOTS|FRAME|<counter>|<unsigned EIP-8141 tx bytes, signature elided>
//        sigHash = keccak(those bytes); the device decodes them (RLP) to show sender, frames and fees
// No Arduino dependencies, so tools/firmware-check.mjs runs the same code on the host.
#pragma once
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "keccak.h"

namespace cs {

static const int COLS = 21;  // System5x7 at 1x on a 128 px OLED
static const int MAX_LINES = 40;
static const size_t MAX_BYTES = 3072;

struct Screen {
  char title[11];
  char lines[MAX_LINES][COLS + 1];
  int n;
  bool truncated;
  void reset(const char* t) {
    snprintf(title, sizeof title, "%s", t);
    n = 0;
    truncated = false;
  }
  /** Adds text, wrapped over as many 21-character lines as it needs. */
  void add(const char* s) {
    size_t len = strlen(s);
    size_t i = 0;
    do {
      if (n >= MAX_LINES) {
        truncated = true;
        return;
      }
      size_t k = len - i < (size_t)COLS ? len - i : (size_t)COLS;
      memcpy(lines[n], s + i, k);
      lines[n][k] = 0;
      n++;
      i += k;
    } while (i < len);
  }
  void addf(const char* fmt, ...) {
    char buf[160];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    add(buf);
  }
};

// ---------- parsing ----------
struct Field {
  const char* p;
  size_t n;
};
static int split(const char* s, size_t n, Field* f, int maxf) {
  int k = 0;
  size_t st = 0;
  for (size_t i = 0; i <= n; i++)
    if (i == n || s[i] == '|') {
      if (k < maxf) f[k++] = {s + st, i - st};
      st = i + 1;
    }
  return k;
}
static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
static bool parse_hex(Field f, uint8_t* out, size_t cap, size_t* len) {
  const char* p = f.p;
  size_t n = f.n;
  if (n >= 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2, n -= 2;
  if (n % 2 || n / 2 > cap) return false;
  for (size_t i = 0; i < n / 2; i++) {
    int a = hexval(p[2 * i]), b = hexval(p[2 * i + 1]);
    if (a < 0 || b < 0) return false;
    out[i] = (uint8_t)(a << 4 | b);
  }
  *len = n / 2;
  return true;
}
static bool parse_addr(Field f, uint8_t out[20]) {
  size_t n;
  return parse_hex(f, out, 20, &n) && n == 20;
}
/** Up to 64 hex digits (odd counts allowed, "0x0" is zero), left-padded into a big-endian word. */
static bool parse_u256(Field f, uint8_t out[32]) {
  const char* p = f.p;
  size_t n = f.n;
  if (n >= 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2, n -= 2;
  if (!n || n > 64) return false;
  memset(out, 0, 32);
  for (size_t i = 0; i < n; i++) {
    int v = hexval(p[n - 1 - i]);
    if (v < 0) return false;
    out[31 - i / 2] |= (uint8_t)(i % 2 ? v << 4 : v);
  }
  return true;
}
static bool parse_u64(Field f, uint64_t* out) {
  if (!f.n || f.n > 19) return false;
  uint64_t v = 0;
  for (size_t i = 0; i < f.n; i++) {
    if (f.p[i] < '0' || f.p[i] > '9') return false;
    v = v * 10 + (uint64_t)(f.p[i] - '0');
  }
  *out = v;
  return true;
}

// ---------- ABI words ----------
static void put_u64(uint8_t w[32], uint64_t v) {
  memset(w, 0, 32);
  for (int i = 0; i < 8; i++) w[31 - i] = (uint8_t)(v >> (8 * i));
}
static void put_addr(uint8_t w[32], const uint8_t a[20]) {
  memset(w, 0, 12);
  memcpy(w + 12, a, 20);
}
/** A word that fits in 64 bits (the top 24 bytes are zero). */
static bool word_u64(const uint8_t* w, uint64_t* out) {
  for (int i = 0; i < 24; i++)
    if (w[i]) return false;
  uint64_t v = 0;
  for (int i = 24; i < 32; i++) v = v << 8 | w[i];
  *out = v;
  return true;
}
static bool word_is_addr(const uint8_t* w) {
  for (int i = 0; i < 12; i++)
    if (w[i]) return false;
  return true;
}
static bool is_zero(const uint8_t* b, size_t n) {
  for (size_t i = 0; i < n; i++)
    if (b[i]) return false;
  return true;
}
static size_t pad32(size_t n) { return (n + 31) / 32 * 32; }

// ---------- formatting ----------
static void hex_str(const uint8_t* b, size_t n, char* out) {
  static const char* H = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) out[2 * i] = H[b[i] >> 4], out[2 * i + 1] = H[b[i] & 15];
  out[2 * n] = 0;
}
/** The full address, 42 characters (two screen lines). */
static void addr_full(const uint8_t a[20], char out[43]) {
  out[0] = '0', out[1] = 'x';
  hex_str(a, 20, out + 2);
}
static void addr_short(const uint8_t a[20], char out[13]) {
  char h[41];
  hex_str(a, 20, h);
  snprintf(out, 13, "0x%.4s..%.4s", h, h + 36);
}
/** 256-bit big-endian to decimal. */
static void u256_dec(const uint8_t v[32], char* out, size_t cap) {
  uint8_t t[32];
  memcpy(t, v, 32);
  char rev[80];
  int n = 0;
  bool more;
  do {
    uint32_t rem = 0;
    more = false;
    for (int i = 0; i < 32; i++) {
      uint32_t cur = rem << 8 | t[i];
      t[i] = (uint8_t)(cur / 10);
      rem = cur % 10;
      if (t[i]) more = true;
    }
    rev[n++] = (char)('0' + rem);
  } while (more && n < 79);
  size_t k = 0;
  for (int i = n - 1; i >= 0 && k + 1 < cap; i--) out[k++] = rev[i];
  out[k] = 0;
}
/** An amount with `decimals` places, trailing zeros trimmed; "~" marks a rounded display (max 16 chars). */
static void units(const uint8_t v[32], int decimals, char* out, size_t cap) {
  char d[80];
  u256_dec(v, d, sizeof d);
  size_t len = strlen(d);
  char s[100];
  if ((int)len <= decimals) {
    size_t z = (size_t)decimals - len + 1;
    memset(s, '0', z);
    memcpy(s + z, d, len + 1);
    len += z;
  } else
    memcpy(s, d, len + 1);
  size_t ip = len - (size_t)decimals;  // integer digits
  char r[100];
  memcpy(r, s, ip);
  size_t k = ip;
  size_t fe = len;
  while (fe > ip && s[fe - 1] == '0') fe--;
  if (fe > ip) {
    r[k++] = '.';
    memcpy(r + k, s + ip, fe - ip);
    k += fe - ip;
  }
  r[k] = 0;
  if (k > 16 && ip < 15) {
    r[15] = '~';
    r[16] = 0;
    k = 16;
  }
  if (k >= cap) k = cap - 1;
  memcpy(out, r, k);
  out[k] = 0;
}
/**
 * This signer is testnet-only: it refuses any other chain, whatever the host asks. A production build would list the
 * chains its owner enables, and changing that list would need the button.
 */
static bool chain_allowed(uint64_t id) { return id == 11155111 || id == 1337; }

static void chain_name(uint64_t id, char* out, size_t cap) {
  if (id == 11155111) snprintf(out, cap, "Sepolia testnet");
  else if (id == 1337) snprintf(out, cap, "EIP-8141 devnet 1337");
  else if (id == 1) snprintf(out, cap, "! Ethereum MAINNET");
  else snprintf(out, cap, "chain %llu", (unsigned long long)id);
}
static void fmt_deadline(uint64_t t, char* out, size_t cap) {
  if (t > 100000000000ULL) return (void)snprintf(out, cap, "no time limit");
  int64_t z = (int64_t)(t / 86400) + 719468;
  uint32_t rem = (uint32_t)(t % 86400);
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  uint32_t doe = (uint32_t)(z - era * 146097);
  uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  uint32_t mp = (5 * doy + 2) / 153;
  uint32_t d = doy - (153 * mp + 2) / 5 + 1;
  uint32_t m = mp < 10 ? mp + 3 : mp - 9;
  snprintf(out, cap, "valid to %02u-%02u %02u:%02uZ", m, d, rem / 3600, (rem % 3600) / 60);
}

// ---------- known functions ----------
struct Fn {
  uint32_t sel;
  const char* name;
};
static const Fn FNS[] = {
    {0xa9059cbb, "transfer"},        {0x095ea7b3, "approve"},          {0x23b872dd, "transferFrom"},
    {0xc7279f88, "setText"},         {0x10f13a8c, "setText"},          {0xb4436dde, "setAddress"},
    {0xd5fa2b00, "setAddr"},         {0x8b95dd71, "setAddr"},          {0xc5d7badd, "setContenthash"},
    {0x304e6ade, "setContenthash"},  {0xbc7b6d62, "setResolver"},      {0x341ec559, "setSubregistry"},
    {0xf242432a, "safeTransferFrom"},{0x2eb2c2d6, "safeBatchTransfer"},{0x7c300586, "grantRoles"},
    {0xdfa70d8b, "revokeRoles"},     {0x072d5d77, "grantRootRoles"},   {0xce156e82, "revokeRootRoles"},
    {0xa22cb465, "setApprovalForAll"},{0x85f3e643, "register"},        {0x5569f33d, "renew"},
    {0xccd3eaff, "grantSetterRoles"},{0x33cc44a0, "initialize"},       {0xac9650d8, "multicall"},
    {0x4f1ef286, "upgradeToAndCall"},{0x6a761202, "execTransaction"},  {0xe19a9dd9, "setGuard"},
    {0xf08a0323, "setFallbackHandler"},{0x8d80ff0a, "multiSend"},      {0x0d582f13, "addOwnerWithThreshold"},
    {0xf8dc5dd9, "removeOwner"},     {0xe318b52b, "swapOwner"},        {0x694e80c3, "changeThreshold"},
    {0x610b5925, "enableModule"},    {0xe009cfde, "disableModule"},    {0xcffe5bd6, "approveMessage"},
    {0x70a1fc58, "cancelRecovery"},  {0x923689e4, "startRecovery"},    {0xc7423803, "finishRecovery"},
    {0xa5598683, "rotate"},
};
static const char* fn_name(uint32_t sel) {
  for (const Fn& f : FNS)
    if (f.sel == sel) return f.name;
  return nullptr;
}

/** Argument i of calldata args `a` (after the selector). */
static const uint8_t* arg(const uint8_t* a, size_t n, int i) { return (size_t)(i + 1) * 32 <= n ? a + 32 * i : nullptr; }
static bool arg_dyn(const uint8_t* a, size_t n, int i, const uint8_t** p, size_t* len) {
  const uint8_t* w = arg(a, n, i);
  uint64_t off, l;
  if (!w || !word_u64(w, &off) || off > n || n - off < 32 || !word_u64(a + off, &l) || l > n - off - 32) return false;
  *p = a + off + 32;
  *len = (size_t)l;
  return true;
}
static bool printable(const uint8_t* p, size_t n) {
  for (size_t i = 0; i < n; i++)
    if (p[i] < 0x20 || p[i] > 0x7e) return false;
  return true;
}
static void add_text(Screen& sc, const char* prefix, const uint8_t* p, size_t n) {
  char buf[160];
  if (!printable(p, n)) return sc.addf("%s(not plain text)", prefix);
  size_t k = n < 120 ? n : 120;
  snprintf(buf, sizeof buf, "%s%.*s%s", prefix, (int)k, (const char*)p, n > k ? "~" : "");
  sc.add(buf);
}
/** A DNS-encoded name (ENSv2 resolvers take these) as "label.label". */
static void add_dns_name(Screen& sc, const uint8_t* p, size_t n) {
  char out[120];
  size_t k = 0, i = 0;
  while (i < n && p[i]) {
    size_t l = p[i++];
    if (l > n - i || !printable(p + i, l) || k + l + 2 >= sizeof out) return sc.add("name: (unreadable)");
    if (k) out[k++] = '.';
    memcpy(out + k, p + i, l);
    k += l;
    i += l;
  }
  out[k] = 0;
  sc.addf("name %s", k ? out : "(root)");
}
static void add_addr_full(Screen& sc, const char* label, const uint8_t a[20]) {
  char f[43];
  addr_full(a, f);
  sc.add(label);
  sc.add(f);
}

/** One call: to, value, data, in words. */
static void describe_call(Screen& sc, const uint8_t to[20], const uint8_t value[32], const uint8_t* data, size_t dlen) {
  char amt[24], s[13];
  bool has_value = !is_zero(value, 32);
  if (has_value) units(value, 18, amt, sizeof amt);
  if (!dlen) {
    sc.addf("send %s ETH", has_value ? amt : "0");
    return add_addr_full(sc, "to", to);
  }
  addr_short(to, s);
  if (dlen < 4) {
    sc.addf("call %s", s);
    return sc.addf("! %u odd data bytes", (unsigned)dlen);
  }
  uint32_t sel = (uint32_t)data[0] << 24 | (uint32_t)data[1] << 16 | (uint32_t)data[2] << 8 | data[3];
  const char* nm = fn_name(sel);
  const uint8_t* a = data + 4;
  size_t an = dlen - 4;
  if (nm) sc.addf("%s", nm);
  else sc.addf("! unknown fn 0x%08lx", (unsigned long)sel);
  sc.addf("on %s", s);
  if (has_value) sc.addf("+ %s ETH", amt);
  const uint8_t *w0 = arg(a, an, 0), *w1 = arg(a, an, 1), *w2 = arg(a, an, 2);
  const uint8_t* p;
  size_t pl;
  char num[24];
  switch (sel) {
    case 0xa9059cbb:  // transfer(address,uint256)
    case 0x095ea7b3:  // approve(address,uint256)
      if (w0 && w1 && word_is_addr(w0)) {
        add_addr_full(sc, sel == 0xa9059cbb ? "to" : "! spender", w0 + 12);
        uint8_t ff[32];
        memset(ff, 0xff, 32);
        if (!memcmp(w1, ff, 32)) sc.add("! amount UNLIMITED");
        else {
          u256_dec(w1, num, sizeof num);
          sc.addf("amount %s units", num);
        }
      }
      break;
    case 0xc7279f88:  // ENSv2 setText(bytes name, string key, string value)
      if (arg_dyn(a, an, 0, &p, &pl)) add_dns_name(sc, p, pl);
      if (arg_dyn(a, an, 1, &p, &pl)) add_text(sc, "key ", p, pl);
      if (arg_dyn(a, an, 2, &p, &pl)) add_text(sc, "= ", p, pl);
      break;
    case 0x10f13a8c:  // setText(bytes32 node, string key, string value)
      if (arg_dyn(a, an, 1, &p, &pl)) add_text(sc, "key ", p, pl);
      if (arg_dyn(a, an, 2, &p, &pl)) add_text(sc, "= ", p, pl);
      break;
    case 0xb4436dde:  // ENSv2 setAddress(bytes name, uint256 coinType, bytes addressBytes)
      if (arg_dyn(a, an, 0, &p, &pl)) add_dns_name(sc, p, pl);
      if (w1) u256_dec(w1, num, sizeof num), sc.addf("coin type %s", num);
      if (arg_dyn(a, an, 2, &p, &pl)) {
        if (pl == 20) add_addr_full(sc, "address", p);
        else sc.addf("address %u bytes", (unsigned)pl);
      }
      break;
    case 0xbc7b6d62:  // setResolver(uint256 id, address resolver)
      if (w0 && w1 && word_is_addr(w1)) {
        char h[65];
        hex_str(w0, 32, h);
        sc.addf("name id %.6s..%.4s", h, h + 60);
        add_addr_full(sc, "new resolver", w1 + 12);
      }
      break;
    case 0xf242432a:  // safeTransferFrom(from, to, id, value, data)
      if (w1 && word_is_addr(w1)) add_addr_full(sc, "! give to", w1 + 12);
      if (w2) {
        char h[65];
        hex_str(w2, 32, h);
        sc.addf("token id %.6s..%.4s", h, h + 60);
      }
      break;
    case 0x7c300586:  // grantRoles(id, bitmap, account)
    case 0xdfa70d8b:  // revokeRoles(id, bitmap, account)
      if (w2 && word_is_addr(w2)) {
        char a2[13];
        addr_short(w2 + 12, a2);
        sc.addf("%s %s", sel == 0x7c300586 ? "! to" : "from", a2);
      }
      break;
    case 0xa22cb465:  // setApprovalForAll(operator, bool)
      if (w0 && w1 && word_is_addr(w0)) {
        sc.add(w1[31] ? "! operator ON" : "operator OFF");
        char f[43];
        addr_full(w0 + 12, f);
        sc.add(f);
      }
      break;
    case 0xe19a9dd9:  // setGuard(address)
    case 0xf08a0323:  // setFallbackHandler(address)
    case 0x610b5925:  // enableModule(address)
      if (w0 && word_is_addr(w0)) add_addr_full(sc, "! to", w0 + 12);
      break;
    case 0x0d582f13:  // addOwnerWithThreshold(owner, threshold)
      if (w0 && word_is_addr(w0)) add_addr_full(sc, "! new owner", w0 + 12);
      break;
    case 0xe318b52b:  // swapOwner(prev, old, new)
      if (w2 && word_is_addr(w2)) add_addr_full(sc, "! new owner", w2 + 12);
      break;
    case 0x694e80c3:  // changeThreshold(uint256)
      if (w0) u256_dec(w0, num, sizeof num), sc.addf("! threshold %s", num);
      break;
    case 0x8d80ff0a: {  // multiSend(bytes): op(1) ‖ to(20) ‖ value(32) ‖ len(32) ‖ data
      if (!arg_dyn(a, an, 0, &p, &pl)) break;
      size_t i = 0;
      int k = 0;
      while (i + 85 <= pl && k < 8) {
        uint64_t l;
        if (!word_u64(p + i + 53, &l) || l > pl - i - 85) break;
        char t[13];
        addr_short(p + i + 1, t);
        const char* inm = l >= 4 ? fn_name((uint32_t)p[i + 85] << 24 | (uint32_t)p[i + 86] << 16 | (uint32_t)p[i + 87] << 8 | p[i + 88]) : "send";
        sc.addf("%s%d %s", p[i] ? "! DELEGATE " : "", ++k, inm ? inm : "unknown fn");
        sc.addf("  on %s", t);
        i += 85 + (size_t)l;
      }
      if (i != pl) sc.add("! more calls inside");
      break;
    }
    default:
      if (an) sc.addf("args %u bytes", (unsigned)an);
  }
}

// ---------- the four request kinds ----------
static uint8_t g_buf[MAX_BYTES];

static const char* req_msg(Field* f, int nf, Screen& sc, uint8_t out[32]) {
  size_t n;
  if (nf != 4 || !parse_hex(f[3], g_buf, 512, &n)) return "usage";
  if (!n || !printable(g_buf, n)) return "msg-not-plain-text";
  static const char PREFIX[] = "\x19Lifeboat Signed Message:\n";
  char len[12];
  snprintf(len, sizeof len, "%u", (unsigned)n);
  static uint8_t m[600];
  size_t k = 0;
  memcpy(m, PREFIX, sizeof PREFIX - 1), k += sizeof PREFIX - 1;
  memcpy(m + k, len, strlen(len)), k += strlen(len);
  memcpy(m + k, g_buf, n), k += n;
  lb::keccak256(m, k, out);
  sc.reset("MESSAGE");
  sc.add("sign this text:");
  char t[520];
  memcpy(t, g_buf, n);
  t[n] = 0;
  sc.add(t);
  return nullptr;
}

/** abi.encode(Call[]) with Call = (address target, uint256 value, bytes data). Canonical encoding only. */
struct Call {
  const uint8_t* to;
  const uint8_t* value;
  const uint8_t* data;
  size_t dlen;
};
static int decode_calls(const uint8_t* b, size_t n, Call* c, int maxc) {
  uint64_t v, cnt;
  if (n < 64 || !word_u64(b, &v) || v != 32 || !word_u64(b + 32, &cnt) || cnt == 0 || cnt > (uint64_t)maxc) return -1;
  size_t base = 64, expect = 32 * (size_t)cnt;
  if (n < base + expect) return -1;
  for (size_t i = 0; i < cnt; i++) {
    uint64_t off, doff, dl;
    if (!word_u64(b + base + 32 * i, &off) || off != expect) return -1;  // tuples follow each other, in order
    size_t t = base + (size_t)off;
    if (n < t + 128 || !word_is_addr(b + t) || !word_u64(b + t + 64, &doff) || doff != 96 || !word_u64(b + t + 96, &dl)) return -1;
    if (dl > n - t - 128 || n - t - 128 < pad32((size_t)dl)) return -1;
    if (!is_zero(b + t + 128 + dl, pad32((size_t)dl) - (size_t)dl)) return -1;
    c[i] = {b + t + 12, b + t + 32, b + t + 128, (size_t)dl};
    expect += 128 + pad32((size_t)dl);
  }
  return n == base + expect ? (int)cnt : -1;
}

static const char* req_pqw(Field* f, int nf, Screen& sc, uint8_t out[32], uint32_t device_leaf) {
  uint64_t chain, leaf, deadline;
  uint8_t wallet[20];
  size_t n;
  if (nf != 8 || !parse_u64(f[3], &chain) || !parse_addr(f[4], wallet) || !parse_u64(f[5], &leaf) || !parse_u64(f[6], &deadline) || !parse_hex(f[7], g_buf, MAX_BYTES, &n))
    return "usage";
  if (!chain_allowed(chain)) return "chain-not-allowed";
  if (leaf != device_leaf) return "leaf-mismatch";
  Call calls[4];
  int nc = decode_calls(g_buf, n, calls, 4);
  if (nc < 0) return "calls-not-canonical";
  uint8_t b[256];
  memset(b, 0, sizeof b);
  put_u64(b, 0xc0);
  put_u64(b + 32, chain);
  put_addr(b + 64, wallet);
  put_u64(b + 96, leaf);
  put_u64(b + 128, deadline);
  lb::keccak256(g_buf, n, b + 160);
  put_u64(b + 192, 14);
  memcpy(b + 224, "LIFEBOAT_PQ_V1", 14);
  lb::keccak256(b, sizeof b, out);

  char s[40];
  sc.reset("PQ WALLET");
  chain_name(chain, s, sizeof s);
  sc.add(s);
  addr_short(wallet, s);
  sc.addf("wallet %s", s);
  fmt_deadline(deadline, s, sizeof s);
  sc.add(s);
  for (int i = 0; i < nc; i++) {
    if (nc > 1) sc.addf("-- call %d of %d --", i + 1, nc);
    describe_call(sc, calls[i].to, calls[i].value, calls[i].data, calls[i].dlen);
  }
  return nullptr;
}

static const char* req_safe(Field* f, int nf, Screen& sc, uint8_t out[32]) {
  uint64_t chain, op, safe_gas, base_gas, nonce;
  uint8_t guard[20], safe[20], to[20], gas_token[20], refund[20], value[32], gas_price[32];
  size_t n;
  if (nf != 16 || !parse_u64(f[3], &chain) || !parse_addr(f[4], guard) || !parse_addr(f[5], safe) || !parse_addr(f[6], to) || !parse_u256(f[7], value) ||
      !parse_hex(f[8], g_buf, MAX_BYTES, &n) || !parse_u64(f[9], &op) || op > 1 || !parse_u64(f[10], &safe_gas) || !parse_u64(f[11], &base_gas) ||
      !parse_u256(f[12], gas_price) || !parse_addr(f[13], gas_token) || !parse_addr(f[14], refund) || !parse_u64(f[15], &nonce))
    return "usage";
  if (!chain_allowed(chain)) return "chain-not-allowed";
  // Safe 1.4.1 getTransactionHash (EIP-712)
  static const char DOMAIN[] = "EIP712Domain(uint256 chainId,address verifyingContract)";
  static const char SAFE_TX[] =
      "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)";
  uint8_t d[96], st[352], pre[66], h[32];
  lb::keccak256((const uint8_t*)DOMAIN, sizeof DOMAIN - 1, d);
  put_u64(d + 32, chain);
  put_addr(d + 64, safe);
  lb::keccak256(d, 96, pre + 2);
  lb::keccak256((const uint8_t*)SAFE_TX, sizeof SAFE_TX - 1, st);
  put_addr(st + 32, to);
  memcpy(st + 64, value, 32);
  lb::keccak256(g_buf, n, st + 96);
  put_u64(st + 128, op);
  put_u64(st + 160, safe_gas);
  put_u64(st + 192, base_gas);
  memcpy(st + 224, gas_price, 32);
  put_addr(st + 256, gas_token);
  put_addr(st + 288, refund);
  put_u64(st + 320, nonce);
  lb::keccak256(st, sizeof st, pre + 34);
  pre[0] = 0x19, pre[1] = 0x01;
  lb::keccak256(pre, sizeof pre, h);
  // the guard's digest, kind 0 = a transaction
  uint8_t b[256];
  memset(b, 0, sizeof b);
  put_u64(b, 0xc0);
  put_u64(b + 32, 0);
  put_u64(b + 64, chain);
  put_addr(b + 96, guard);
  put_addr(b + 128, safe);
  memcpy(b + 160, h, 32);
  put_u64(b + 192, 25);
  memcpy(b + 224, "LIFEBOAT_QUANTUM_GUARD_V1", 25);
  lb::keccak256(b, sizeof b, out);

  char s[40];
  sc.reset("SAFE TX");
  chain_name(chain, s, sizeof s);
  sc.add(s);
  addr_short(safe, s);
  sc.addf("Safe %s", s);
  sc.addf("nonce %llu", (unsigned long long)nonce);
  if (op == 1) sc.add("! DELEGATECALL");
  describe_call(sc, to, value, g_buf, n);
  if (!is_zero(gas_price, 32)) {
    char g[24];
    units(gas_price, 9, g, sizeof g);
    sc.addf("! refund %s gwei/gas", g);
    addr_short(refund, s);
    sc.addf("  to %s", s);
  }
  addr_short(guard, s);
  sc.addf("guard %s", s);
  return nullptr;
}

// RLP
struct Rlp {
  bool list;
  const uint8_t* p;
  size_t n;
};
static bool rlp_next(const uint8_t*& p, const uint8_t* end, Rlp& it) {
  if (p >= end) return false;
  size_t avail = (size_t)(end - p), hdr, len;
  uint8_t b = *p;
  bool list;
  if (b < 0x80) {
    it = {false, p, 1};
    p += 1;
    return true;
  }
  if (b <= 0xb7) list = false, hdr = 1, len = b - 0x80;
  else if (b <= 0xbf || b > 0xf7) {
    size_t ll = b <= 0xbf ? b - 0xb7 : b - 0xf7;
    list = b > 0xf7;
    if (ll > 3 || avail < 1 + ll) return false;
    len = 0;
    for (size_t i = 0; i < ll; i++) len = len << 8 | p[1 + i];
    hdr = 1 + ll;
  } else
    list = true, hdr = 1, len = b - 0xc0;
  if (avail < hdr || avail - hdr < len) return false;
  it = {list, p + hdr, len};
  p += hdr + len;
  return true;
}
static bool rlp_u256(const Rlp& it, uint8_t out[32]) {
  if (it.list || it.n > 32) return false;
  memset(out, 0, 32);
  memcpy(out + 32 - it.n, it.p, it.n);
  return true;
}
static bool rlp_u64(const Rlp& it, uint64_t* v) {
  uint8_t w[32];
  return rlp_u256(it, w) && word_u64(w, v);
}
/** Splits a list into up to `max` children; returns the count, or -1. */
static int rlp_children(const Rlp& l, Rlp* c, int max) {
  if (!l.list) return -1;
  const uint8_t *p = l.p, *end = l.p + l.n;
  int k = 0;
  while (p < end) {
    if (k == max || !rlp_next(p, end, c[k])) return -1;
    k++;
  }
  return k;
}

static const char* req_frame(Field* f, int nf, Screen& sc, uint8_t out[32], uint32_t device_leaf) {
  size_t n;
  if (nf != 4 || !parse_hex(f[3], g_buf, MAX_BYTES, &n) || n < 2) return "usage";
  if (g_buf[0] != 0x06) return "not-a-frame-tx";
  const uint8_t* p = g_buf + 1;
  Rlp top, it[9];
  if (!rlp_next(p, g_buf + n, top) || p != g_buf + n || rlp_children(top, it, 9) != 9) return "bad-rlp";
  uint64_t chain, nonce;
  uint8_t fee[32];
  Rlp frames[8], sigs[4], fees[3], tmp[8];
  int nfr = rlp_children(it[4], frames, 8), nsig = rlp_children(it[5], sigs, 4);
  if (!rlp_u64(it[0], &chain) || !rlp_u64(it[2], &nonce) || it[3].list || it[3].n != 20 || nfr < 1 || nsig < 1 || rlp_children(it[6], fees, 3) != 3 || !rlp_u256(fees[1], fee))
    return "bad-rlp";
  if (!chain_allowed(chain)) return "chain-not-allowed";
  // every signature entry this hash covers must have its signature bytes elided
  for (int i = 0; i < nsig; i++) {
    Rlp e[4];
    if (rlp_children(sigs[i], e, 4) != 4) return "bad-rlp";
    if (e[2].n == 0 && e[3].n != 0) return "signature-not-elided";
  }
  lb::keccak256(g_buf, n, out);

  char s[40];
  const uint8_t* sender = it[3].p;
  sc.reset("FRAME TX");
  chain_name(chain, s, sizeof s);
  sc.add(s);
  addr_short(sender, s);
  sc.addf("from %s", s);
  sc.addf("nonce %llu", (unsigned long long)nonce);
  int nk = rlp_children(it[1], tmp, 8);
  if (nk != 0) sc.addf("! %d nonce keys", nk);
  for (int i = 0; i < nfr; i++) {
    Rlp fr[6], lim[2];
    uint64_t mode;
    uint8_t value[32];
    if (rlp_children(frames[i], fr, 6) != 6 || !rlp_u64(fr[0], &mode) || fr[2].list || (fr[2].n != 0 && fr[2].n != 20) || !rlp_u256(fr[4], value) || fr[5].list ||
        rlp_children(fr[3], lim, 2) != 2)
      return "bad-rlp";
    const uint8_t* target = fr[2].n ? fr[2].p : sender;
    const uint8_t* data = fr[5].p;
    size_t dl = fr[5].n;
    if (mode == 1) {
      addr_short(target, s);
      sc.addf("%d check: %s", i + 1, s);
      continue;
    }
    sc.addf("%d %s", i + 1, mode == 2 ? "SENDER (your act)" : mode == 0 ? "DEFAULT call" : "! unknown frame");
    // LifeboatAccount's SENDER frame: leaf ‖ to ‖ value, sent from the account itself
    if (mode == 2 && !memcmp(target, sender, 20) && dl == 96 && word_is_addr(data + 32)) {
      uint64_t leaf;
      char amt[24];
      units(data + 64, 18, amt, sizeof amt);
      sc.addf("send %s ETH", amt);
      add_addr_full(sc, "to", data + 44);
      if (!word_u64(data, &leaf) || leaf != device_leaf) sc.add("! leaf differs");
      continue;
    }
    describe_call(sc, target, value, data, dl);
  }
  if (rlp_children(it[7], tmp, 8) != 0) sc.add("! carries blobs");
  if (rlp_children(it[8], tmp, 8) != 0) sc.add("+ recent-root refs");
  char g[24];
  units(fee, 9, g, sizeof g);
  sc.addf("max fee %s gwei/gas", g);
  return nullptr;
}

/**
 * Builds the screen and the hash to sign from one request line. Returns nullptr on success, or a short reason.
 * `device_leaf` is the leaf the device will use: requests that name a leaf must name that one.
 */
static const char* build_request(const char* line, size_t len, Screen& sc, uint8_t sig_hash[32], uint32_t* counter, uint32_t device_leaf) {
  Field f[17];
  int nf = split(line, len, f, 17);
  uint64_t c;
  if (nf < 2 || f[0].n != 4 || memcmp(f[0].p, "WOTS", 4)) return "usage";
  const Field& k = f[1];
  if (k.n == 4 && !memcmp(k.p, "SIGN", 4)) return "blind-signing-off";  // a bare hash can't be shown in words
  if (nf < 4 || !parse_u64(f[2], &c) || c > 0xffffffffULL) return "usage";
  *counter = (uint32_t)c;
  if (k.n == 3 && !memcmp(k.p, "MSG", 3)) return req_msg(f, nf, sc, sig_hash);
  if (k.n == 3 && !memcmp(k.p, "PQW", 3)) return req_pqw(f, nf, sc, sig_hash, device_leaf);
  if (k.n == 4 && !memcmp(k.p, "SAFE", 4)) return req_safe(f, nf, sc, sig_hash);
  if (k.n == 5 && !memcmp(k.p, "FRAME", 5)) return req_frame(f, nf, sc, sig_hash, device_leaf);
  return "unknown";
}

}  // namespace cs
