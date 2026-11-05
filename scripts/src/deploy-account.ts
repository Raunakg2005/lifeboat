// Deploys a LifeboatAccount for a WOTS+C key on the alt-mempool devnet (CREATE2, deterministic) and funds it.
// Usage: pnpm --filter @lifeboat/scripts deploy-account [--label demo] [--fund 0.05]
import { concat, formatEther, getContractAddress, parseEther, type Hex } from "viem";
import { argValue } from "./lib/env.js";
import { CREATE2_FACTORY, devWallet, publicClient, saveEvidence, yulInitcode } from "./lib/devnet.js";
import { loadOrCreateKey, publicView, saveKeyFile } from "./lib/pqkey.js";

const label = argValue("--label") ?? "demo";
const fund = parseEther(argValue("--fund") ?? "0.05");

const { file, created } = loadOrCreateKey(label);
console.log(created ? `new WOTS+C key "${label}"` : `existing WOTS+C key "${label}"`, publicView(file));

const initcode = concat([yulInitcode("LifeboatAccount"), file.root as Hex, file.pubSeed as Hex]);
const salt = file.root as Hex; // one account per key
const predicted = getContractAddress({ opcode: "CREATE2", from: CREATE2_FACTORY, salt, bytecode: initcode });

const pub = publicClient();
const { account: dev, client } = devWallet();
console.log(`dev wallet ${dev.address}: ${formatEther(await pub.getBalance({ address: dev.address }))} ETH`);

let deployTx: Hex | undefined;
let receipt;
const existing = await pub.getCode({ address: predicted });
if (existing && existing !== "0x") {
  console.log(`account already deployed at ${predicted}`);
} else {
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  deployTx = await client.sendTransaction({ to: CREATE2_FACTORY, data: concat([salt, initcode]), gas: 10_000_000n, gasPrice, type: "legacy" });
  console.log(`deploy tx ${deployTx}`);
  receipt = await pub.waitForTransactionReceipt({ hash: deployTx, timeout: 180_000 });
  console.log(`deployed in block ${receipt.blockNumber}, status ${receipt.status}, gas used ${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error("deploy reverted");
}

const code = await pub.getCode({ address: predicted });
const slots = await Promise.all([0n, 1n, 2n].map((s) => pub.getStorageAt({ address: predicted, slot: `0x${s.toString(16)}` as Hex })));
if (!code || code === "0x") throw new Error("no code at the predicted address");
if (slots[0] !== file.root || slots[1] !== file.pubSeed) throw new Error("storage does not hold this key");
console.log(`code ${(code.length - 2) / 2} bytes; root and pubSeed in storage; leaf floor slot = ${BigInt(slots[2]!)}`);

let fundTx: Hex | undefined;
const bal = await pub.getBalance({ address: predicted });
if (bal < fund / 2n) {
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  fundTx = await client.sendTransaction({ to: predicted, value: fund, gas: 100_000n, gasPrice, type: "legacy" });
  await pub.waitForTransactionReceipt({ hash: fundTx, timeout: 180_000 });
  console.log(`funded with ${formatEther(fund)} ETH (tx ${fundTx})`);
}
console.log(`account balance ${formatEther(await pub.getBalance({ address: predicted }))} ETH, nonce ${await pub.getTransactionCount({ address: predicted })}`);

file.account = predicted;
saveKeyFile(file);
const path = saveEvidence(`deploy-${label}`, {
  chainId: 1337,
  account: predicted,
  factory: CREATE2_FACTORY,
  salt,
  root: file.root,
  pubSeed: file.pubSeed,
  runtimeBytes: (code.length - 2) / 2,
  deployTx,
  deployBlock: receipt?.blockNumber,
  deployGasUsed: receipt?.gasUsed,
  fundTx,
});
console.log(`evidence: ${path}`);
