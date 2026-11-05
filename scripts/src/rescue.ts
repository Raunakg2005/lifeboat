// The rescue: an exposed EOA with tokens but no ETH sweeps them to its post-quantum LifeboatAccount,
// with gas sponsored by the RescuePaymaster and repaid in mock USDC inside the same frame transaction.
//
// Three-way admission demo, with every answer saved to evidence/ef/:
//   1. canonical mempool (ethrex eth_sendRawTransaction)   -> expected: rejected (validation reads shared state)
//   2. alt mempool, paymaster NOT staked (gateway sidecar)  -> expected: rejected (ERC-7562 storage rules)
//   3. alt mempool, paymaster staked                         -> expected: admitted and included
// Usage: pnpm --filter @lifeboat/scripts rescue [--to 0xPQaccount] [--no-stake] [--dry]
import { readFileSync } from "node:fs";
import { encodeFunctionData, formatEther, getAddress, parseAbi, parseEther, parseGwei, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeTx, frame, newTx, secp256k1Placeholder, signTx, type FrameTx } from "@forshtat/hegota-support/tx";
import { explainRejection, toWire } from "@forshtat/hegota-support/rpc";
import { argValue, hasFlag, repoPath } from "./lib/env.js";
import { GATEWAY_URL, MINER_SIDECAR_URL, NODE_URL, devWallet, explorerTx, profile, publicClient, saveEvidence } from "./lib/devnet.js";
import { loadDeployments } from "./lib/deployments.js";
import { loadOrCreateKey } from "./lib/pqkey.js";
import { rpc, RpcCallError } from "./lib/rpc.js";

const REGISTRY: Address = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f"; // NaiveStakingRegistry on chain 1337
const STAKE = parseEther("0.012"); // sidecar minimum is 0.01 ETH
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const pmAbi = parseAbi(["function exec(address,uint256,bytes)", "function fee() view returns (uint256)"]);
const regAbi = parseAbi([
  "function addStake(uint32 unstakeDelaySec) payable",
  // NaiveStakingRegistry answers getDepositInfo with three words (not the 5-field ERC-4337 struct)
  "function getDepositInfo(address) view returns (uint256 w0, uint256 w1, uint256 w2)",
]);

const d = loadDeployments();
if (!d.usdc || !d.paymaster) throw new Error("run rescue-setup first");
const usdc = getAddress(d.usdc);
const paymaster = getAddress(d.paymaster);
const eoa = privateKeyToAccount(JSON.parse(readFileSync(repoPath("secrets", "rescue-eoa.json"), "utf8")).privateKey as Hex);
const dest = getAddress(argValue("--to") ?? loadOrCreateKey("demo").file.account ?? "");
const pub = publicClient();

const usdcBal = (a: Address) => pub.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [a] });
const stakeInfo = async () => {
  const words = (await pub.readContract({ address: REGISTRY, abi: regAbi, functionName: "getDepositInfo", args: [paymaster] })) as readonly bigint[];
  return { words, staked: words.some((w) => w >= parseEther("0.01")) };
};

const fee = await pub.readContract({ address: paymaster, abi: pmAbi, functionName: "fee" });
const balance = await usdcBal(eoa.address);
if (balance <= fee) throw new Error(`exposed EOA has ${balance} mUSDC, needs more than the ${fee} fee`);
const before = {
  eoaEth: formatEther(await pub.getBalance({ address: eoa.address })),
  eoaUsdc: Number(balance) / 1e6,
  destUsdc: Number(await usdcBal(dest)) / 1e6,
  paymasterUsdc: Number(await usdcBal(paymaster)) / 1e6,
  paymasterEth: formatEther(await pub.getBalance({ address: paymaster })),
};
console.log(`exposed EOA ${eoa.address} -> PQ account ${dest}; paymaster ${paymaster}`, before);

const block = await pub.getBlock();
const baseFee = block.baseFeePerGas ?? parseGwei("1");
const maxPriorityFeePerGas = parseGwei("1");
const nonce = await pub.getTransactionCount({ address: eoa.address });

const unsigned: FrameTx = newTx({
  chainId: 1337n,
  sender: eoa.address,
  nonceSeq: BigInt(nonce),
  frames: [
    frame(profile, "VERIFY", { execution: 30_000n, scope: "EXECUTION" }), // the EOA's own signature (default code)
    frame(profile, "VERIFY", { target: paymaster, execution: 40_000n, scope: "PAYMENT" }), // the sponsor
    frame(profile, "SENDER", { target: usdc, execution: 60_000n, state: 120_000n, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [paymaster, fee] }) }), // repay first
    frame(profile, "SENDER", { target: usdc, execution: 60_000n, state: 120_000n, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [dest, balance - fee] }) }), // sweep
  ],
  signatures: [secp256k1Placeholder(profile)],
  fees: { maxFeePerGas: baseFee * 2n + maxPriorityFeePerGas, maxPriorityFeePerGas },
});
const tx = await signTx(profile, unsigned, (JSON.parse(readFileSync(repoPath("secrets", "rescue-eoa.json"), "utf8")).privateKey) as Hex, 0);
const raw = encodeTx(profile, tx);
const evidence: Record<string, unknown> = { chainId: 1337, sender: eoa.address, paymaster, usdc, dest, fee, sweep: balance - fee, nonce, before, raw };

// 0. dry run
const sim = await rpc<any>(NODE_URL(), "ethrex_simulateFrameTransaction", [raw, "latest", { trace: false }]);
const simSummary = {
  canonicalMempoolValid: sim.canonicalMempoolValid,
  canonicalMempoolViolation: sim.canonicalMempoolViolation,
  prefixShape: sim.prefixShape,
  payer: sim.payer,
  gasUsed: sim.gasUsed && BigInt(sim.gasUsed),
  maxCost: sim.maxCost && formatEther(BigInt(sim.maxCost)),
  failedFrameIndex: sim.failedFrameIndex,
  haltReason: sim.haltReason,
  revertData: sim.revertData,
  frames: (sim.frames ?? []).map((f: any) => ({ gasUsed: BigInt(f.gasUsed), succeeded: f.succeeded })),
};
console.log("simulation:", simSummary);
evidence.simulation = sim;
if (hasFlag("--dry")) {
  saveEvidence("rescue-dryrun", evidence);
  process.exit(0);
}
if (sim.failedFrameIndex !== undefined && sim.failedFrameIndex !== null) throw new Error("simulation failed; not submitting");

async function submit(where: "canonical" | "alt") {
  try {
    const hash =
      where === "canonical"
        ? await rpc<Hex>(NODE_URL(), "eth_sendRawTransaction", [raw], { retries: 1 })
        : await rpc<Hex>(GATEWAY_URL(), "eth_sendFrameTransaction", [toWire(tx)], { retries: 1 });
    return { admitted: true as const, hash };
  } catch (e) {
    if (!(e instanceof RpcCallError)) throw e;
    return { admitted: false as const, message: e.message, code: e.code, data: e.data, rule: explainRejection(e.message).rule };
  }
}

// 1. canonical mempool
if (sim.canonicalMempoolValid) {
  console.log("canonical: simulation says the canonical mempool would accept it; skipping so the tx isn't spent there");
  evidence.canonical = { skipped: true, reason: "canonicalMempoolValid = true" };
} else {
  const r = await submit("canonical");
  console.log("1. canonical mempool:", r.admitted ? `ADMITTED?! ${r.hash}` : `rejected: ${r.message}`);
  evidence.canonical = r;
  if (r.admitted) throw new Error("canonical mempool admitted it: stop, the demo assumption is wrong");
}

// 2. alt mempool, unstaked
let info = await stakeInfo();
evidence.stakeBefore = info;
if (!info.staked) {
  const r = await submit("alt");
  console.log("2. alt mempool, paymaster unstaked:", r.admitted ? `ADMITTED ${r.hash}` : `rejected (${r.rule}): ${r.message}`);
  evidence.altUnstaked = r;
  if (r.admitted) {
    evidence.note = "admitted while unstaked";
    saveEvidence("rescue", evidence);
    process.exit(0);
  }
} else console.log("2. paymaster already staked: skipping the unstaked attempt");

if (hasFlag("--no-stake")) {
  saveEvidence("rescue-unstaked", evidence);
  process.exit(0);
}

// 3. stake the paymaster (owner = dev wallet; the paymaster calls the registry itself)
if (!info.staked) {
  const { client } = devWallet();
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  const stakeTx = await client.sendTransaction({
    to: paymaster,
    data: encodeFunctionData({ abi: pmAbi, functionName: "exec", args: [REGISTRY, STAKE, encodeFunctionData({ abi: regAbi, functionName: "addStake", args: [1] })] }),
    gas: 1_000_000n,
    gasPrice,
    type: "legacy",
  });
  const sr = await pub.waitForTransactionReceipt({ hash: stakeTx, timeout: 180_000 });
  info = await stakeInfo();
  console.log(`3. staked ${formatEther(STAKE)} ETH: ${stakeTx} (status ${sr.status}); registry says`, info);
  evidence.stakeTx = stakeTx;
  evidence.stakeAfter = info;
  if (!info.staked) throw new Error("registry does not report the paymaster as staked");
}

// 4. alt mempool, staked
const r = await submit("alt");
console.log("4. alt mempool, paymaster staked:", r.admitted ? `ADMITTED ${r.hash}` : `rejected (${r.rule}): ${r.message}`);
evidence.altStaked = r;
if (!r.admitted) {
  saveEvidence("rescue-failed", evidence);
  process.exit(1);
}
evidence.explorer = explorerTx(r.hash);
for (const [name, url] of [["gateway", GATEWAY_URL()], ["miner", MINER_SIDECAR_URL()]] as const) {
  evidence[`${name}Explorer`] = await rpc(url, "skandha_explorer_getTransaction", [r.hash], { retries: 1 }).catch((e) => ({ error: String(e.message) }));
}
let receipt: any = null;
for (let i = 0; i < 60 && !receipt; i++) {
  receipt = await rpc(NODE_URL(), "eth_getTransactionReceipt", [r.hash]).catch(() => null);
  if (!receipt) await new Promise((res) => setTimeout(res, 3000));
}
evidence.receipt = receipt;
const after = {
  eoaEth: formatEther(await pub.getBalance({ address: eoa.address })),
  eoaUsdc: Number(await usdcBal(eoa.address)) / 1e6,
  destUsdc: Number(await usdcBal(dest)) / 1e6,
  paymasterUsdc: Number(await usdcBal(paymaster)) / 1e6,
  paymasterEth: formatEther(await pub.getBalance({ address: paymaster })),
};
evidence.after = after;
const path = saveEvidence("rescue", evidence);
console.log(receipt ? `INCLUDED in block ${BigInt(receipt.blockNumber)}, status ${receipt.status}` : "not included yet", "\nexplorer:", explorerTx(r.hash));
console.log("after:", after, "\nevidence:", path);
