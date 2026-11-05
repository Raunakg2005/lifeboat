// Sets up the rescue demo on the alt-mempool devnet:
//   mock USDC (behind an EIP-1967 proxy), the RescuePaymaster (unstaked at first), and an "exposed" EOA
//   that holds 100 mUSDC and no ETH, registered with the paymaster.
// Usage: pnpm --filter @lifeboat/scripts rescue-setup
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { concat, encodeAbiParameters, encodeFunctionData, formatEther, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { repoPath } from "./lib/env.js";
import { devWallet, publicClient, saveEvidence, yulInitcode } from "./lib/devnet.js";
import { forgeBytecode, loadDeployments, saveDeployments } from "./lib/deployments.js";

const FEE = 1_000_000n; // 1 mUSDC per rescue
const MAX_COST = parseEther("0.01"); // sponsor at most 0.01 ETH of gas per rescue
const usdcAbi = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const pmAbi = parseAbi(["function setEligible(address,bool)", "function isEligible(address) view returns (uint256)", "function owner() view returns (address)"]);

const pub = publicClient();
const { account: dev, client } = devWallet();
const d = loadDeployments();

async function send(label: string, req: { to?: Address; data?: Hex; value?: bigint; gas?: bigint }): Promise<Address | undefined> {
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  const hash = await client.sendTransaction({ ...req, to: req.to ?? null, gas: req.gas ?? 3_000_000n, gasPrice, type: "legacy" } as any);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
  d.txs[label] = hash;
  console.log(`${label}: ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  return r.contractAddress ?? undefined;
}

if (!d.usdcImpl) d.usdcImpl = await send("deploy MockUSDCImpl", { data: forgeBytecode("MockUSDC.sol", "MockUSDCImpl"), gas: 6_000_000n });
if (!d.usdc) {
  const ctor = encodeAbiParameters([{ type: "address" }], [d.usdcImpl!]);
  d.usdc = await send("deploy USDC proxy", { data: concat([forgeBytecode("MockUSDC.sol", "Proxy1967"), ctor]), gas: 3_000_000n });
}
saveDeployments(d);

if (!d.paymaster) {
  const args = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [d.usdc!, FEE, MAX_COST]);
  d.paymaster = await send("deploy RescuePaymaster", { data: concat([yulInitcode("RescuePaymaster"), args]), gas: 4_000_000n });
  d.paymasterOwner = dev.address;
}
saveDeployments(d);
if ((await pub.getBalance({ address: d.paymaster! })) < parseEther("0.03")) await send("fund paymaster 0.05 ETH", { to: d.paymaster, value: parseEther("0.05"), gas: 100_000n });

// the "exposed" wallet: tokens, no ETH. Its throwaway key lives in secrets/ (gitignored).
const eoaPath = repoPath("secrets", "rescue-eoa.json");
if (!existsSync(eoaPath)) {
  mkdirSync(repoPath("secrets"), { recursive: true });
  writeFileSync(eoaPath, JSON.stringify({ privateKey: `0x${randomBytes(32).toString("hex")}` }), { mode: 0o600 });
}
const eoa = privateKeyToAccount(JSON.parse(readFileSync(eoaPath, "utf8")).privateKey as Hex);
d.rescueEoa = eoa.address;
saveDeployments(d);

if ((await pub.readContract({ address: d.usdc!, abi: usdcAbi, functionName: "balanceOf", args: [eoa.address] })) === 0n)
  await send("mint 100 mUSDC to the exposed EOA", { to: d.usdc, data: encodeFunctionData({ abi: usdcAbi, functionName: "mint", args: [eoa.address, 100_000_000n] }), gas: 1_000_000n });
if ((await pub.readContract({ address: d.paymaster!, abi: pmAbi, functionName: "isEligible", args: [eoa.address] })) === 0n)
  await send("register the exposed EOA with the paymaster", { to: d.paymaster, data: encodeFunctionData({ abi: pmAbi, functionName: "setEligible", args: [eoa.address, true] }), gas: 1_000_000n });
saveDeployments(d);

const state = {
  usdc: d.usdc,
  paymaster: d.paymaster,
  paymasterOwner: await pub.readContract({ address: d.paymaster!, abi: pmAbi, functionName: "owner" }),
  paymasterEth: formatEther(await pub.getBalance({ address: d.paymaster! })),
  exposedEoa: eoa.address,
  exposedEoaEth: formatEther(await pub.getBalance({ address: eoa.address })),
  exposedEoaUsdc: Number(await pub.readContract({ address: d.usdc!, abi: usdcAbi, functionName: "balanceOf", args: [eoa.address] })) / 1e6,
  txs: d.txs,
};
console.log(state);
saveEvidence("rescue-setup", state);
