// The attack a one-time key must never allow: forging from reused signatures.
//
// Every WOTS+C signature reveals, for each of the 64 chains, the value at position d_i (the digest digit).
// Anyone can hash forward from there. Several signatures by the SAME leaf reveal, per chain, the lowest
// position m_i any of them exposed. A forger then needs a digest for their own message whose digits all
// satisfy t_i >= m_i (and still sum to TARGET_SUM); hashing forward gives a valid signature.
//
// With 2 reuses that's astronomically unlikely (~2^59 tries); with 5 it takes tens of thousands of tries,
// i.e. well under a second. This is why Lifeboat burns a fresh leaf per signing attempt, including fee bumps.
import { chain, digitSum, digitsOf, messageDigest } from "./hash.js";
import { LEN, MAX_STEP, TARGET_SUM } from "./params.js";
import { decodeWitness, encodeWitness, type PublicKey } from "./wots.js";

export interface Observed {
  sigHash: Uint8Array;
  witness: Uint8Array;
}

export interface ForgeResult {
  witness: Uint8Array;
  counter: number;
  tries: number;
  minPositions: number[]; // per chain, the lowest position revealed by the observed signatures
}

/** Per chain: the lowest revealed position and its value, across signatures that all used the same leaf. */
export function exposure(pub: PublicKey, observed: Observed[]) {
  if (!observed.length) throw new Error("need at least one observed signature");
  const ws = observed.map((o) => ({ ...decodeWitness(o.witness), sigHash: o.sigHash }));
  const leaf = ws[0]!.leaf;
  if (ws.some((w) => w.leaf !== leaf)) throw new Error("observed signatures use different leaves: nothing to combine");
  const min = new Array<number>(LEN).fill(MAX_STEP);
  const val: Uint8Array[] = new Array(LEN);
  for (const w of ws) {
    const digits = digitsOf(messageDigest(pub.pubSeed, leaf, pub.root, w.sigHash, w.counter));
    digits.forEach((d, i) => {
      if (d <= min[i]! || !val[i]) {
        if (d < min[i]! || !val[i]) {
          min[i] = d;
          val[i] = w.sigs[i]!;
        }
      }
    });
  }
  return { leaf, min, val, path: ws[0]!.path };
}

/** Tries to forge a signature over `target` from reused signatures. Returns null if not found within maxTries. */
export function forge(pub: PublicKey, observed: Observed[], target: Uint8Array, maxTries = 5_000_000): ForgeResult | null {
  const { leaf, min, val, path } = exposure(pub, observed);
  for (let counter = 0; counter < maxTries; counter++) {
    const t = digitsOf(messageDigest(pub.pubSeed, leaf, pub.root, target, counter));
    let ok = true;
    for (let i = 0; i < LEN; i++)
      if (t[i]! < min[i]!) {
        ok = false;
        break;
      }
    if (!ok || digitSum(t) !== TARGET_SUM) continue;
    const sigs = t.map((d, i) => chain(pub.pubSeed, leaf, i, val[i]!, min[i]!, d));
    return { witness: encodeWitness({ leaf, counter, sigs, path }), counter, tries: counter + 1, minPositions: min };
  }
  return null;
}

/** log2 of the expected number of tries, estimated by sampling (for showing why 2 reuses ≠ 5 reuses). */
export function estimateTriesLog2(pub: PublicKey, observed: Observed[], samples = 200_000): number {
  const { leaf, min } = exposure(pub, observed);
  const probe = new Uint8Array(32);
  let hits = 0;
  let sumHits = 0;
  for (let c = 0; c < samples; c++) {
    probe[0] = c & 0xff;
    probe[1] = (c >>> 8) & 0xff;
    probe[2] = (c >>> 16) & 0xff;
    const t = digitsOf(messageDigest(pub.pubSeed, leaf, pub.root, probe, 7));
    if (digitSum(t) === TARGET_SUM) {
      sumHits++;
      if (t.every((d, i) => d >= min[i]!)) hits++;
    }
  }
  if (hits > 0) return Math.log2(samples / hits);
  // no full hit: estimate P(sum) * Π per-chain P(digit >= m_i) under a uniform-digit model
  const pSum = Math.max(sumHits, 1) / samples;
  const pDom = min.reduce((p, m) => p * ((16 - m) / 16), 1);
  return Math.log2(1 / (pSum * pDom));
}
