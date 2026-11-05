import { beforeAll, describe, expect, it } from "vitest";
import {
  LEAVES,
  TARGET_SUM,
  TREE_HEIGHT,
  WITNESS_BYTES,
  authPath,
  decodeWitness,
  digitSum,
  digitsOf,
  encodeWitness,
  generateKeyPair,
  grind,
  leafHash,
  leafPublicChains,
  messageDigest,
  rootFromPath,
  sign,
  verify,
  type KeyPair,
} from "../src/index.js";

const seed = (b: number) => new Uint8Array(32).fill(b);
const hash = (b: number) => {
  const h = new Uint8Array(32);
  h[0] = b;
  h[31] = 0xa5;
  return h;
};

let key: KeyPair;

beforeAll(() => {
  key = generateKeyPair(seed(1), seed(2));
}, 60_000);

describe("key generation", () => {
  it("builds a full tree with a 32-byte root", () => {
    expect(key.levels.length).toBe(TREE_HEIGHT + 1);
    expect(key.levels[0]!.length).toBe(LEAVES);
    expect(key.root.length).toBe(32);
  });

  it("is deterministic for the same seeds and differs for another seed", () => {
    const again = generateKeyPair(seed(1), seed(2));
    expect(again.root).toEqual(key.root);
    const other = generateKeyPair(seed(3), seed(2));
    expect(other.root).not.toEqual(key.root);
  }, 60_000);

  it("auth paths lead back to the root for every leaf", () => {
    for (let leaf = 0; leaf < LEAVES; leaf += 17) {
      const lh = key.levels[0]![leaf]!;
      expect(rootFromPath(key.pubSeed, leaf, lh, authPath(key.levels, leaf))).toEqual(key.root);
    }
  });

  it("a path is bound to its index: the same path at another index fails", () => {
    const lh = key.levels[0]![5]!;
    expect(rootFromPath(key.pubSeed, 4, lh, authPath(key.levels, 5))).not.toEqual(key.root);
  });
});

describe("sign and verify", () => {
  it("round-trips at the first, last and a middle leaf", () => {
    for (const leaf of [0, 137, LEAVES - 1]) {
      const sh = hash(leaf);
      const { witness } = sign(key, leaf, sh);
      expect(witness.length).toBe(WITNESS_BYTES);
      expect(verify(key, sh, witness)).toBe(true);
    }
  });

  it("the digest of a valid signature always sums to TARGET_SUM", () => {
    const sh = hash(9);
    const { witness, grind: g } = sign(key, 9, sh);
    const w = decodeWitness(witness);
    expect(w.counter).toBe(g.counter);
    expect(digitSum(digitsOf(messageDigest(key.pubSeed, 9, key.root, sh, w.counter)))).toBe(TARGET_SUM);
  });

  it("rejects a different sigHash", () => {
    const { witness } = sign(key, 3, hash(3));
    expect(verify(key, hash(4), witness)).toBe(false);
  });

  it("rejects any flipped chain byte or path byte", () => {
    const { witness } = sign(key, 7, hash(7));
    for (const pos of [32, 32 * 33 + 5, 32 * 64 + 31, 32 * 65, WITNESS_BYTES - 1]) {
      const bad = witness.slice();
      bad[pos]! ^= 0x01;
      expect(verify(key, hash(7), bad)).toBe(false);
    }
  });

  it("rejects a moved leaf index or counter in the header", () => {
    const { witness } = sign(key, 10, hash(10));
    const w = decodeWitness(witness);
    expect(verify(key, hash(10), encodeWitness({ ...w, leaf: 11 }))).toBe(false);
    expect(verify(key, hash(10), encodeWitness({ ...w, counter: w.counter + 1 }))).toBe(false);
  });

  it("rejects a wrong length, non-zero header padding and another key's root", () => {
    const { witness } = sign(key, 12, hash(12));
    expect(verify(key, hash(12), witness.slice(0, WITNESS_BYTES - 32))).toBe(false);
    const padded = witness.slice();
    padded[0] = 1;
    expect(verify(key, hash(12), padded)).toBe(false);
    expect(verify({ root: hash(1), pubSeed: key.pubSeed }, hash(12), witness)).toBe(false);
  });

  it("rejects leaves outside the tree", () => {
    expect(() => sign(key, LEAVES, hash(1))).toThrow();
    expect(() => sign(key, -1, hash(1))).toThrow();
  });
});

describe("WOTS+C property", () => {
  it("pushing one chain forward without fixing the sum fails", () => {
    // A forger who sees one signature can hash any chain value forward, which raises that digit.
    // With a fixed digit sum, the digest of any other message must lower some other digit: impossible without the secret.
    const sh = hash(20);
    const { witness } = sign(key, 20, sh);
    const w = decodeWitness(witness);
    const pks = leafPublicChains(key.skSeed, key.pubSeed, 20);
    const lh = leafHash(key.pubSeed, 20, pks);
    expect(rootFromPath(key.pubSeed, 20, lh, w.path)).toEqual(key.root);
    // try other counters for another message: any whose digits all dominate the signed ones would forge; none exist with an equal sum
    const signedDigits = digitsOf(messageDigest(key.pubSeed, 20, key.root, sh, w.counter));
    const target = hash(21);
    let dominated = 0;
    for (let c = 0; c < 20_000; c++) {
      const d = digitsOf(messageDigest(key.pubSeed, 20, key.root, target, c));
      if (digitSum(d) === TARGET_SUM && d.every((x, i) => x >= signedDigits[i]!)) dominated++;
    }
    expect(dominated).toBe(0);
  });

  it("grinding takes a modest number of tries", () => {
    let total = 0;
    const runs = 40;
    for (let i = 0; i < runs; i++) total += grind(key, i, hash(100 + i)).tries;
    const avg = total / runs;
    console.log(`average grind tries at TARGET_SUM=${TARGET_SUM}: ${avg.toFixed(0)}`);
    expect(avg).toBeLessThan(5000);
  });
});
