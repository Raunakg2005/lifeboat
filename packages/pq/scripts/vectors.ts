// Writes contracts/test/vectors/wots.json: signatures made by the TypeScript signer, plus tampered copies,
// so the Yul verifier is tested against exactly what the wallet produces.
import { mkdirSync, writeFileSync } from "node:fs";
import { decodeWitness, encodeWitness, generateKeyPair, sign, toHex, verify } from "../src/index.js";

const fill = (b: number) => new Uint8Array(32).fill(b);
const hashOf = (label: string) => {
  const h = new Uint8Array(32);
  for (let i = 0; i < label.length; i++) h[i % 32] = (h[i % 32]! * 31 + label.charCodeAt(i)) & 0xff;
  h[31] ^= 0x5a;
  return h;
};

const key = generateKeyPair(fill(0x11), fill(0x22));
const cases: { name: string; sigHash: string; witness: string; valid: boolean }[] = [];
const add = (name: string, sigHash: Uint8Array, witness: Uint8Array) => {
  cases.push({ name, sigHash: toHex(sigHash), witness: toHex(witness), valid: verify(key, sigHash, witness) });
};

for (const leaf of [0, 1, 77, 128, 255]) {
  const sh = hashOf(`tx-${leaf}`);
  add(`valid leaf ${leaf}`, sh, sign(key, leaf, sh).witness);
}

const sh = hashOf("tamper");
const { witness } = sign(key, 42, sh);
const flip = (pos: number) => {
  const w = witness.slice();
  w[pos]! ^= 1;
  return w;
};
add("valid leaf 42", sh, witness);
add("wrong sigHash", hashOf("other"), witness);
add("flipped first chain value", sh, flip(32));
add("flipped last chain value", sh, flip(32 * 64 + 31));
add("flipped auth path", sh, flip(32 * 65 + 3));
add("flipped last auth path byte", sh, flip(32 * 73 - 1));
add("non-zero header padding", sh, flip(0));
const w = decodeWitness(witness);
add("leaf index moved", sh, encodeWitness({ ...w, leaf: 43 }));
add("counter changed", sh, encodeWitness({ ...w, counter: w.counter + 1 }));
add("leaf out of tree", sh, encodeWitness({ ...w, leaf: 256 }));

const out = { root: toHex(key.root), pubSeed: toHex(key.pubSeed), count: cases.length, cases };
const dir = new URL("../../../contracts/test/vectors/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("wots.json", dir), JSON.stringify(out, null, 2));
console.log(`wrote ${cases.length} vectors (${cases.filter((c) => c.valid).length} valid), root ${out.root}`);
