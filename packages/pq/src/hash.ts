import { keccak_256 } from "@noble/hashes/sha3.js";
import { LEN, MAX_STEP, N, T_CHAIN, T_LEAF, T_MSG, T_NODE, T_SK } from "./params.js";

export const keccak = (data: Uint8Array): Uint8Array => keccak_256(data);

/**
 * The 32-byte tweak that domain-separates every hash:
 *   pubSeed[0:24] ‖ idx (u32, big-endian) ‖ a (u8) ‖ b (u8) ‖ type (u8) ‖ 0x00
 * As a uint256 this is (pubSeed & ~0xffffffffffffffff) | idx << 32 | a << 24 | b << 16 | type << 8,
 * which is how the Yul verifier builds it.
 */
export function writeAdrs(out: Uint8Array, offset: number, pubSeed: Uint8Array, idx: number, a: number, b: number, type: number): void {
  out.set(pubSeed.subarray(0, 24), offset);
  out[offset + 24] = (idx >>> 24) & 0xff;
  out[offset + 25] = (idx >>> 16) & 0xff;
  out[offset + 26] = (idx >>> 8) & 0xff;
  out[offset + 27] = idx & 0xff;
  out[offset + 28] = a & 0xff;
  out[offset + 29] = b & 0xff;
  out[offset + 30] = type & 0xff;
  out[offset + 31] = 0;
}

/** Applies chain steps `from`..`to-1` of chain `chainIdx` of `leaf` to `x`. */
export function chain(pubSeed: Uint8Array, leaf: number, chainIdx: number, x: Uint8Array, from: number, to: number): Uint8Array {
  if (from < 0 || to > MAX_STEP || from > to) throw new Error(`bad chain range ${from}..${to}`);
  const buf = new Uint8Array(64);
  writeAdrs(buf, 0, pubSeed, leaf, chainIdx, 0, T_CHAIN);
  let cur = x;
  for (let j = from; j < to; j++) {
    buf[29] = j;
    buf.set(cur, 32);
    cur = keccak(buf);
  }
  return cur;
}

/** Secret start of chain `chainIdx` of `leaf`: keccak(skSeed ‖ adrs(leaf, chainIdx, 0, SK)). */
export function secretChainStart(skSeed: Uint8Array, pubSeed: Uint8Array, leaf: number, chainIdx: number): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(skSeed.subarray(0, 32), 0);
  writeAdrs(buf, 32, pubSeed, leaf, chainIdx, 0, T_SK);
  return keccak(buf);
}

/** Leaf hash: keccak(adrs(leaf, 0, 0, LEAF) ‖ pk_0 ‖ … ‖ pk_63). */
export function leafHash(pubSeed: Uint8Array, leaf: number, pks: Uint8Array[]): Uint8Array {
  if (pks.length !== LEN) throw new Error("need 64 chain ends");
  const buf = new Uint8Array(32 + LEN * N);
  writeAdrs(buf, 0, pubSeed, leaf, 0, 0, T_LEAF);
  pks.forEach((pk, i) => buf.set(pk, 32 + i * N));
  return keccak(buf);
}

/** Merkle node at `level` (1 = just above the leaves) and position `idx` within that level. */
export function nodeHash(pubSeed: Uint8Array, level: number, idx: number, left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(96);
  writeAdrs(buf, 0, pubSeed, idx, level, 0, T_NODE);
  buf.set(left, 32);
  buf.set(right, 64);
  return keccak(buf);
}

/** Message digest: keccak(adrs(leaf, 0, 0, MSG) ‖ root ‖ sigHash ‖ uint256(counter)). */
export function messageDigest(pubSeed: Uint8Array, leaf: number, root: Uint8Array, sigHash: Uint8Array, counter: number): Uint8Array {
  const buf = new Uint8Array(128);
  writeAdrs(buf, 0, pubSeed, leaf, 0, 0, T_MSG);
  buf.set(root, 32);
  buf.set(sigHash, 64);
  buf[124] = (counter >>> 24) & 0xff;
  buf[125] = (counter >>> 16) & 0xff;
  buf[126] = (counter >>> 8) & 0xff;
  buf[127] = counter & 0xff;
  return keccak(buf);
}

/** The 64 base-16 digits of a digest, high nibble of byte 0 first. */
export function digitsOf(digest: Uint8Array): number[] {
  const out: number[] = new Array(LEN);
  for (let i = 0; i < 32; i++) {
    const byte = digest[i]!;
    out[2 * i] = byte >>> 4;
    out[2 * i + 1] = byte & 0x0f;
  }
  return out;
}

export const digitSum = (digits: number[]): number => digits.reduce((s, d) => s + d, 0);
