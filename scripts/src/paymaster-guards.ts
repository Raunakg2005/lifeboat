// Dry-runs (never submitted) showing that the RescuePaymaster refuses to pay unless it is repaid.
// Each case changes one thing a malicious sender could try; the paymaster's VERIFY frame (index 1) must fail.
// Usage: pnpm --filter @lifeboat/scripts paymaster-guards
import { randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, parseAbi, parseGwei, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeTx, frame, newTx, secp256k1Placeholder, signTx, type Frame } from "@forshtat/hegota-support/tx";
import { NODE_URL, devWallet, profile, publicClient, saveEvidence } from "./lib/devnet.js";
import { loadDeployments } from "./lib/deployments.js";
import { rpc } from "./lib/rpc.js";

const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const pmAbi = parseAbi(["function setEligible(address,bool)", "function fee() view returns (uint256)"]);
const d = loadDeployments();
const usdc = getAddress(d.usdc!);
const paymaster = getAddress(d.paymaster!);
const pub = publicClient();
const { client } = devWallet();
const fee = await pub.readContract({ address: paymaster, abi: pmAbi, functionName: "fee" });

async function legacy(to: Address, data: Hex) {
  const hash = await client.sendTransaction({ to, data, gas: 1_000_000n, gasPrice: ((await pub.getGasPrice()) * 12n) / 10n, type: "legacy" });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`setup tx reverted ${hash}`);
}

// throwaway senders: one registered with 10 mUSDC, one never registered (also 10 mUSDC). Keys are never stored.
const registeredKey = `0x${randomBytes(32).toString("hex")}` as Hex;
const strangerKey = `0x${randomBytes(32).toString("hex")}` as Hex;
const registered = privateKeyToAccount(registeredKey);
const stranger = privateKeyToAccount(strangerKey);
for (const a of [registered, stranger]) await legacy(usdc, encodeFunctionData({ abi: erc20, functionName: "mint", args: [a.address, 10_000_000n] }));
await legacy(paymaster, encodeFunctionData({ abi: pmAbi, functionName: "setEligible", args: [registered.address, true] }));
console.log(`registered sender ${registered.address}, unregistered sender ${stranger.address}, fee ${fee}`);

const baseFee = (await pub.getBlock()).baseFeePerGas ?? parseGwei("1");
const transfer = (to: Address, amount: bigint) => encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, amount] });
const repay = (amount = fee, to: Address = paymaster, flags = 0) => frame(profile, "SENDER", { target: usdc, execution: 60_000n, state: 120_000n, flags, data: transfer(to, amount) });
const PQ_ACCOUNT = getAddress("0x555B4f232D65ED910F30F8897FA83705E35824dc"); // the demo LifeboatAccount
const sweep = (amount = 5_000_000n) => frame(profile, "SENDER", { target: usdc, execution: 60_000n, state: 120_000n, data: transfer(PQ_ACCOUNT, amount) });

async function simulate(name: string, key: Hex, sender: Address, after: Frame[]) {
  const tx = await signTx(
    profile,
    newTx({
      chainId: 1337n,
      sender,
      nonceSeq: BigInt(await pub.getTransactionCount({ address: sender })),
      frames: [frame(profile, "VERIFY", { execution: 30_000n, scope: "EXECUTION" }), frame(profile, "VERIFY", { target: paymaster, execution: 40_000n, scope: "PAYMENT" }), ...after],
      signatures: [secp256k1Placeholder(profile)],
      fees: { maxFeePerGas: baseFee * 2n + parseGwei("1"), maxPriorityFeePerGas: parseGwei("1") },
    }),
    key,
    0,
  );
  const sim = await rpc<any>(NODE_URL(), "ethrex_simulateFrameTransaction", [encodeTx(profile, tx), "latest", { trace: false }]);
  const paymasterOk = sim.frames?.[1]?.succeeded === true;
  return { name, paymasterApproved: paymasterOk, failedFrameIndex: sim.failedFrameIndex ?? null, haltReason: sim.haltReason ?? null, frames: (sim.frames ?? []).map((f: any) => f.succeeded) };
}

const cases = [
  await simulate("control: repay fee, then sweep", registeredKey, registered.address, [repay(), sweep()]),
  await simulate("repays less than the fee", registeredKey, registered.address, [repay(fee - 1n), sweep()]),
  await simulate("repays someone else", registeredKey, registered.address, [repay(fee, registered.address), sweep()]),
  await simulate("repay frame batched with a later frame (could be undone)", registeredKey, registered.address, [repay(fee, paymaster, 0x4), sweep()]),
  await simulate("no repay frame: sweeps first", registeredKey, registered.address, [sweep(), repay()]),
  await simulate("unregistered sender", strangerKey, stranger.address, [repay(), sweep()]),
];
console.table(cases.map((c) => ({ case: c.name, "paymaster approves": c.paymasterApproved, failedFrame: c.failedFrameIndex })));
const expected = [true, false, false, false, false, false];
const allGood = cases.every((c, i) => c.paymasterApproved === expected[i]);
saveEvidence("paymaster-guards", { paymaster, usdc, fee, cases, allAsExpected: allGood });
console.log(allGood ? "ALL GUARDS HOLD" : "UNEXPECTED RESULT: check evidence/ef/paymaster-guards.json");
process.exit(allGood ? 0 : 1);
