// Builds a self-paid EIP-8141 frame transaction from the LifeboatAccount, signs it with a fresh WOTS+C leaf,
// dry-runs it on ethrex, and (with --send) submits it through the ERC-8421 alt-mempool sidecar.
// Usage: pnpm --filter @lifeboat/scripts send-frame [--label demo] [--to 0x..] [--value 0.001] [--verify-gas 70000] [--send]
import { concat, formatEther, getAddress, numberToHex, pad, parseEther, parseGwei, toHex as vToHex, type Address, type Hex } from "viem";
import { encodeTx, frame, newTx, sigHash, type FrameTx } from "@forshtat/hegota-support/tx";
import { explainRejection, toWire } from "@forshtat/hegota-support/rpc";
import { WITNESS_BYTES, fromHex, sign, toHex, verify } from "@lifeboat/pq";
import { argValue, hasFlag } from "./lib/env.js";
import { GATEWAY_URL, MINER_SIDECAR_URL, NODE_URL, devWallet, explorerTx, profile, publicClient, saveEvidence } from "./lib/devnet.js";
import { loadOrCreateKey, publicView, reserveLeaf } from "./lib/pqkey.js";
import { rpc, RpcCallError } from "./lib/rpc.js";

const label = argValue("--label") ?? "demo";
const send = hasFlag("--send");
const verifyGas = BigInt(argValue("--verify-gas") ?? "70000");
const value = parseEther(argValue("--value") ?? "0.001");

const { file, key } = loadOrCreateKey(label);
if (!file.account) throw new Error(`key "${label}" has no account yet: run deploy-account first`);
const account = getAddress(file.account);
const to: Address = getAddress(argValue("--to") ?? devWallet().account.address);
console.log("key", publicView(file));

const pub = publicClient();
const [nonce, balance, block] = await Promise.all([pub.getTransactionCount({ address: account }), pub.getBalance({ address: account }), pub.getBlock()]);
const baseFee = block.baseFeePerGas ?? parseGwei("1");
const maxPriorityFeePerGas = parseGwei("1");
const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
console.log(`account ${account}: ${formatEther(balance)} ETH, nonce ${nonce}; block ${block.number}, base fee ${baseFee}`);

// The leaf goes into the SENDER frame data (so the account raises its leaf floor), which the sigHash covers.
// So reserve it first: it is written to disk before anything is signed or sent.
const leaf = file.nextLeaf;
const executeData = (l: number): Hex => concat([pad(numberToHex(l), { size: 32 }), pad(to, { size: 32 }), pad(numberToHex(value), { size: 32 })]);

const build = (l: number): FrameTx =>
  newTx({
    chainId: 1337n,
    sender: account,
    nonceSeq: BigInt(nonce),
    frames: [
      frame(profile, "VERIFY", { execution: verifyGas, scope: "EXECUTION_AND_PAYMENT", data: "0x03" }),
      frame(profile, "SENDER", { execution: 80_000n, state: 200_000n, data: executeData(l) }),
    ],
    signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0x" }],
    fees: { maxFeePerGas, maxPriorityFeePerGas },
  });

const unsigned = build(leaf);
const sh = sigHash(profile, unsigned);
const reserved = reserveLeaf(file, `send ${formatEther(value)} ETH to ${to} (nonce ${nonce})`, sh);
if (reserved !== leaf) throw new Error("leaf changed under us");
const { witness, grind } = sign(key, leaf, fromHex(sh));
if (!verify(key, fromHex(sh), witness) || witness.length !== WITNESS_BYTES) throw new Error("local verify failed");
console.log(`signed sigHash ${sh} with leaf ${leaf} (grind ${grind.tries} tries, counter ${grind.counter})`);

const tx: FrameTx = { ...unsigned, signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: toHex(witness) }] };
const raw = encodeTx(profile, tx);
if (sigHash(profile, tx) !== sh) throw new Error("sigHash changed after inserting the witness");

// 1. dry run on ethrex (read-only)
const sim = await rpc<any>(NODE_URL(), "ethrex_simulateFrameTransaction", [raw, "latest", { trace: false }]);
const frames = (sim.frames ?? []).map((f: any, i: number) => ({ i, gasUsed: f.gasUsed, succeeded: f.succeeded }));
console.log("simulation:", {
  canonicalMempoolValid: sim.canonicalMempoolValid,
  canonicalMempoolViolation: sim.canonicalMempoolViolation,
  prefixShape: sim.prefixShape,
  payer: sim.payer,
  gasUsed: sim.gasUsed,
  maxCost: sim.maxCost,
  failedFrameIndex: sim.failedFrameIndex,
  haltReason: sim.haltReason,
  revertData: sim.revertData,
  frames,
});

const evidence: Record<string, unknown> = {
  chainId: 1337,
  account,
  nonce,
  leaf,
  sigHash: sh,
  grindTries: grind.tries,
  witnessBytes: witness.length,
  declaredVerifyGas: verifyGas,
  to,
  value,
  fees: { maxFeePerGas, maxPriorityFeePerGas },
  simulation: sim,
  raw,
};

if (!send) {
  saveEvidence(`simulate-${label}-leaf${leaf}`, evidence);
  console.log("dry run only (pass --send to submit). Note: leaf", leaf, "is now spent; the next run uses", file.nextLeaf);
  process.exit(0);
}

// 2. submit through the alt-mempool gateway sidecar
let hash: Hex;
try {
  hash = await rpc<Hex>(GATEWAY_URL(), "eth_sendFrameTransaction", [toWire(tx)], { retries: 1 });
} catch (e) {
  if (e instanceof RpcCallError) {
    const why = explainRejection(e.message);
    saveEvidence(`rejected-${label}-leaf${leaf}`, { ...evidence, rejection: { message: e.message, data: e.data, rule: why.rule } });
    console.error("REJECTED by the sidecar:", why.rule, e.message, e.data ?? "");
  }
  throw e;
}
console.log(`submitted: ${hash}\nexplorer: ${explorerTx(hash)}`);
evidence.txHash = hash;
evidence.explorer = explorerTx(hash);

// 3. capture the mempool's view right away (explorer history lives in memory and is lost on restarts)
for (const [name, url] of [["gateway", GATEWAY_URL()], ["miner", MINER_SIDECAR_URL()]] as const) {
  try {
    evidence[`${name}Status`] = await rpc(url, "skandha_frameTransactionStatus", [hash], { retries: 1 });
  } catch (e) {
    evidence[`${name}Status`] = { error: String((e as Error).message) };
  }
  try {
    evidence[`${name}Explorer`] = await rpc(url, "skandha_explorer_getTransaction", [hash], { retries: 1 });
  } catch (e) {
    evidence[`${name}Explorer`] = { error: String((e as Error).message) };
  }
}

// 4. wait for inclusion
let receipt: any = null;
for (let i = 0; i < 60 && !receipt; i++) {
  receipt = await rpc(NODE_URL(), "eth_getTransactionReceipt", [hash]).catch(() => null);
  if (!receipt) await new Promise((r) => setTimeout(r, 3000));
}
evidence.receipt = receipt;
const path = saveEvidence(`frame-${label}-leaf${leaf}`, evidence);
if (receipt) console.log(`INCLUDED in block ${BigInt(receipt.blockNumber)}, status ${receipt.status}, gasUsed ${BigInt(receipt.gasUsed)}`);
else console.log("not included yet; check the explorer link");
console.log(`account balance now ${formatEther(await pub.getBalance({ address: account }))} ETH; evidence: ${path}`);
void vToHex;
