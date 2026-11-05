import { chain, digitSum, digitsOf, leafHash, messageDigest, nodeHash, secretChainStart } from "./hash.js";
import { LEAVES, LEN, MAX_STEP, N, TARGET_SUM, TREE_HEIGHT, WITNESS_BYTES } from "./params.js";

export interface PublicKey {
  root: Uint8Array;
  pubSeed: Uint8Array;
}

export interface KeyPair extends PublicKey {
  skSeed: Uint8Array;
  /** levels[0] = leaf hashes, levels[TREE_HEIGHT] = [root]. */
  levels: Uint8Array[][];
}

export interface Grind {
  counter: number;
  digits: number[];
  tries: number;
}

/** Public chain ends of one leaf. */
export function leafPublicChains(skSeed: Uint8Array, pubSeed: Uint8Array, leaf: number): Uint8Array[] {
  const pks: Uint8Array[] = [];
  for (let i = 0; i < LEN; i++) pks.push(chain(pubSeed, leaf, i, secretChainStart(skSeed, pubSeed, leaf, i), 0, MAX_STEP));
  return pks;
}

/** Builds the whole tree: LEAVES leaves of LEN chains each (about 245k hashes). */
export function generateKeyPair(skSeed: Uint8Array, pubSeed: Uint8Array): KeyPair {
  if (skSeed.length !== 32 || pubSeed.length !== 32) throw new Error("seeds must be 32 bytes");
  const leaves: Uint8Array[] = [];
  for (let leaf = 0; leaf < LEAVES; leaf++) leaves.push(leafHash(pubSeed, leaf, leafPublicChains(skSeed, pubSeed, leaf)));
  const levels: Uint8Array[][] = [leaves];
  for (let level = 1; level <= TREE_HEIGHT; level++) {
    const below = levels[level - 1]!;
    const row: Uint8Array[] = [];
    for (let i = 0; i < below.length / 2; i++) row.push(nodeHash(pubSeed, level, i, below[2 * i]!, below[2 * i + 1]!));
    levels.push(row);
  }
  return { skSeed, pubSeed, root: levels[TREE_HEIGHT]![0]!, levels };
}

/** Siblings from the leaf level up: authPath[l-1] is the sibling at level l-1. */
export function authPath(levels: Uint8Array[][], leaf: number): Uint8Array[] {
  const path: Uint8Array[] = [];
  let idx = leaf;
  for (let level = 0; level < TREE_HEIGHT; level++) {
    path.push(levels[level]![idx ^ 1]!);
    idx >>>= 1;
  }
  return path;
}

/** Recomputes the root from a leaf hash and its auth path (index-bound: the position picks left/right and the tweak). */
export function rootFromPath(pubSeed: Uint8Array, leaf: number, leafH: Uint8Array, path: Uint8Array[]): Uint8Array {
  let node = leafH;
  let idx = leaf;
  for (let level = 1; level <= TREE_HEIGHT; level++) {
    const sib = path[level - 1]!;
    const parent = idx >>> 1;
    node = idx & 1 ? nodeHash(pubSeed, level, parent, sib, node) : nodeHash(pubSeed, level, parent, node, sib);
    idx = parent;
  }
  return node;
}

/**
 * Searches for a counter whose digest digits sum to TARGET_SUM. Needs no secret, so any host can grind
 * and hand the counter to a hardware signer.
 */
export function grind(pub: PublicKey, leaf: number, sigHash: Uint8Array, maxTries = 1_000_000): Grind {
  for (let counter = 0; counter < maxTries; counter++) {
    const digits = digitsOf(messageDigest(pub.pubSeed, leaf, pub.root, sigHash, counter));
    if (digitSum(digits) === TARGET_SUM) return { counter, digits, tries: counter + 1 };
  }
  throw new Error(`no counter found in ${maxTries} tries`);
}

/** Chain values revealed for `digits` (the signer side; uses the secret seed). */
export function signDigits(skSeed: Uint8Array, pubSeed: Uint8Array, leaf: number, digits: number[]): Uint8Array[] {
  return digits.map((d, i) => chain(pubSeed, leaf, i, secretChainStart(skSeed, pubSeed, leaf, i), 0, d));
}

export interface Witness {
  leaf: number;
  counter: number;
  sigs: Uint8Array[];
  path: Uint8Array[];
}

export function encodeWitness(w: Witness): Uint8Array {
  if (w.sigs.length !== LEN || w.path.length !== TREE_HEIGHT) throw new Error("bad witness shape");
  const out = new Uint8Array(WITNESS_BYTES);
  // header word: leaf in bytes 24..27, counter in bytes 28..31
  const view = new DataView(out.buffer);
  view.setUint32(24, w.leaf);
  view.setUint32(28, w.counter);
  w.sigs.forEach((s, i) => out.set(s, 32 * (1 + i)));
  w.path.forEach((p, i) => out.set(p, 32 * (1 + LEN + i)));
  return out;
}

export function decodeWitness(bytes: Uint8Array): Witness {
  if (bytes.length !== WITNESS_BYTES) throw new Error(`witness must be ${WITNESS_BYTES} bytes, got ${bytes.length}`);
  for (let i = 0; i < 24; i++) if (bytes[i] !== 0) throw new Error("non-zero high header bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (i: number) => bytes.slice(32 * i, 32 * (i + 1));
  return {
    leaf: view.getUint32(24),
    counter: view.getUint32(28),
    sigs: Array.from({ length: LEN }, (_, i) => word(1 + i)),
    path: Array.from({ length: TREE_HEIGHT }, (_, i) => word(1 + LEN + i)),
  };
}

/** Full signature over a 32-byte sigHash with one leaf. The caller must never reuse `leaf`. */
export function sign(key: KeyPair, leaf: number, sigHash: Uint8Array): { witness: Uint8Array; grind: Grind } {
  if (!Number.isInteger(leaf) || leaf < 0 || leaf >= LEAVES) throw new Error(`leaf out of range: ${leaf}`);
  if (sigHash.length !== 32) throw new Error("sigHash must be 32 bytes");
  const g = grind(key, leaf, sigHash);
  const sigs = signDigits(key.skSeed, key.pubSeed, leaf, g.digits);
  return { witness: encodeWitness({ leaf, counter: g.counter, sigs, path: authPath(key.levels, leaf) }), grind: g };
}

export function verify(pub: PublicKey, sigHash: Uint8Array, witnessBytes: Uint8Array): boolean {
  let w: Witness;
  try {
    w = decodeWitness(witnessBytes);
  } catch {
    return false;
  }
  if (w.leaf >= LEAVES) return false;
  const digits = digitsOf(messageDigest(pub.pubSeed, w.leaf, pub.root, sigHash, w.counter));
  if (digitSum(digits) !== TARGET_SUM) return false;
  const pks = w.sigs.map((s, i) => chain(pub.pubSeed, w.leaf, i, s, digits[i]!, MAX_STEP));
  const root = rootFromPath(pub.pubSeed, w.leaf, leafHash(pub.pubSeed, w.leaf, pks), w.path);
  return equalBytes(root, pub.root);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export { N };
