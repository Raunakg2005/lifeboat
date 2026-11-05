// Publisher: re-verifies each claim on-chain, then writes it to the public Q-Day registry on Arkiv in one batch.
// Nothing is published from a file alone: every entry is checked against the chain it describes first.
// Usage: pnpm --filter @lifeboat/scripts arkiv-publish [--dry]
import { readFileSync } from "node:fs";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { formatEther, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { hasFlag, repoPath } from "./lib/env.js";
import { publicClient as devnetClient } from "./lib/devnet.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";
import { helmCheck } from "@lifeboat/core";
import { Aboard, CHECKER, EXPIRY, Exposure, Leaf, NameCheck, arkivPublic, arkivWallet } from "./lib/arkiv.js";
import { loadOrCreateKey } from "./lib/pqkey.js";

const SCHEME = "WOTS+C-keccak-w16-S560-h8";
const ev = (p: string) => JSON.parse(readFileSync(repoPath(...p.split("/")), "utf8"));
const devnet = devnetClient() as unknown as PublicClient;
const sepolia = sepoliaClient() as unknown as PublicClient;
const checks: { claim: string; ok: boolean; detail: string }[] = [];
const verify = (claim: string, ok: boolean, detail: string) => {
  checks.push({ claim, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${claim}: ${detail}`);
  if (!ok) throw new Error(`refusing to publish: ${claim} did not verify`);
};
const receiptOk = async (c: PublicClient, hash: Hex) => (await c.getTransactionReceipt({ hash })).status === "success";

const creates: any[] = [];

// ---- chain 1337: the EIP-8141 LifeboatAccount and the rescue ----
const demo = loadOrCreateKey("demo").file;
const account = getAddress(demo.account!);
const first = ev("evidence/ef/frame-demo-leaf1.json");
verify("frame tx with leaf 1 landed", await receiptOk(devnet, first.txHash), `${first.txHash} on chain 1337`);
const floor = BigInt(await devnet.getStorageAt({ address: account, slot: "0x2" }) ?? "0x0");
verify("on-chain leaf floor is past leaf 1", floor >= 3n, `slot 2 = ${floor} (lowest usable leaf ${floor - 1n})`);
creates.push({ schema: Leaf, values: { root: demo.root, leaf: u64(1n), account: addr(account), chainId: u64(1337n), digest: first.sigHash, txHash: first.txHash }, expiration: EXPIRY.leaf(), flags: { readonly: true, permissionlessExtension: true } });
const sim0 = ev("evidence/ef/simulate-demo-leaf0.json");
creates.push({ schema: Leaf, values: { root: demo.root, leaf: u64(0n), account: addr(account), chainId: u64(1337n), digest: sim0.sigHash, txHash: "dry-run: revealed to ethrex_simulateFrameTransaction" }, expiration: EXPIRY.leaf(), flags: { readonly: true, permissionlessExtension: true } });

const rescue = ev("evidence/ef/rescue.json");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
verify("rescue sweep landed", await receiptOk(devnet, rescue.altStaked.hash), `${rescue.altStaked.hash} (sponsored by ${rescue.paymaster})`);
const leftover = await devnet.readContract({ address: rescue.usdc, abi: usdcAbi, functionName: "balanceOf", args: [rescue.sender] });
verify("the exposed wallet's tokens are gone", leftover === 0n, `${rescue.sender} holds ${leftover} mUSDC`);
creates.push({
  schema: Aboard,
  values: { from: addr(getAddress(rescue.sender)), to: addr(account), chainId: u64(1337n), kind: "rescue-sweep", scheme: SCHEME, root: demo.root, txHash: rescue.altStaked.hash, note: "0-ETH wallet swept 99 mUSDC; gas paid by a staked paymaster, repaid 1 mUSDC" },
  expiration: EXPIRY.aboard(),
  flags: { readonly: true, permissionlessExtension: true },
});

// ---- Sepolia: the PQ wallet, its first leaf, and the ENS handover ----
const sep = ev("deployments/sepolia.json");
const sepKey = loadOrCreateKey("sepolia").file;
const pqWallet = getAddress(sep.pqWallet);
const handover = ev("evidence/ens/handover.json");
const step = (n: string) => handover.steps.find((s: any) => s.what.startsWith(n));
const pqTx = step("7.").hash as Hex;
verify("PQ wallet's WOTS-signed setText landed", await receiptOk(sepolia, pqTx), pqTx);
const leaf0Used = await sepolia.readContract({ address: pqWallet, abi: parseAbi(["function isLeafUsed(uint256) view returns (bool)"]), functionName: "isLeafUsed", args: [0n] });
verify("Sepolia PQ wallet marks leaf 0 used", leaf0Used, `isLeafUsed(0) = ${leaf0Used}`);
const sepLeafLog = sepKey.log.find((l) => l.leaf === 0)!;
creates.push({ schema: Leaf, values: { root: sepKey.root, leaf: u64(0n), account: addr(pqWallet), chainId: u64(11155111n), digest: sepLeafLog.sigHash, txHash: pqTx }, expiration: EXPIRY.leaf(), flags: { readonly: true, permissionlessExtension: true } });

const name: string = sep.name;
const report = await helmCheck(sepolia, sepoliaLogsClient() as any, [mainnetClient() as any], name, { pqWallets: [pqWallet] });
verify(`fresh Helm check of ${name}`, report.verdict === "protected" && report.owner === pqWallet, `verdict ${report.verdict}, owner ${report.owner}, block ${report.block}`);
creates.push({
  schema: Aboard,
  values: { from: addr(getAddress(sep.oldOwner ?? "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a")), to: addr(pqWallet), chainId: u64(11155111n), kind: "ens-handover", scheme: SCHEME, root: sepKey.root, txHash: step("6.").hash, note: `${name}: registry-verified handover, new resolver, delegate and operator removed` },
  expiration: EXPIRY.aboard(),
  flags: { readonly: true, permissionlessExtension: true },
});
if (!hasFlag("--skip-names")) creates.push({ schema: NameCheck, values: { name, chainId: u64(11155111n), verdict: report.verdict, owner: addr(report.owner), paths: report.hijackablePaths.join(",") || "-", checkedBlock: u64(report.block) }, expiration: EXPIRY.name() });

// ---- exposure attestations for every address in the demo ----
async function exposure(c: PublicClient, chainId: bigint, a: Address, knownPq: boolean) {
  const [code, nonce, bal, block] = await Promise.all([c.getCode({ address: a }), c.getTransactionCount({ address: a }), c.getBalance({ address: a }), c.getBlockNumber()]);
  const status = knownPq ? "pq" : code && code !== "0x" ? "contract" : nonce > 0 ? "exposed" : "not-seen";
  const evidence = status === "exposed" ? `nonce ${nonce} at block ${block}: public key recoverable from any of its txs` : status === "pq" ? "hash-based (WOTS+C) account" : `nonce ${nonce}`;
  console.log(`   exposure ${a} on ${chainId}: ${status} (${formatEther(bal)} ETH)`);
  creates.push({ schema: Exposure, values: { address: addr(a), chainId: u64(chainId), status, via: status === "pq" ? "code" : "nonce", ethAtRisk: dec(status === "exposed" ? formatEther(bal) : "0"), checkedBlock: u64(block), evidence, checker: CHECKER }, expiration: EXPIRY.exposure() });
}
await exposure(devnet, 1337n, account, true);
await exposure(devnet, 1337n, getAddress(rescue.sender), false);
await exposure(sepolia, 11155111n, pqWallet, true);
for (const a of [sep.delegate, sep.operator, "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a"]) await exposure(sepolia, 11155111n, getAddress(a), false);

console.log(`\n${creates.length} entries verified; ${checks.length} on-chain checks passed`);
if (hasFlag("--dry")) process.exit(0);

const { account: writer, client } = arkivWallet();
const pub = arkivPublic();
console.log(`writer ${writer.address}: ${formatEther(await pub.getBalance({ address: writer.address }))} tGLM`);
// Idempotent: the readonly audit trail (leaf uses, aboard records) is written once; re-runs only refresh readings.
const val = (x: any) => String(x && typeof x === "object" && "value" in x ? x.value : x).toLowerCase();
const [haveLeaves, haveAboard] = await Promise.all([
  pub.select({ root: true, leaf: true, digest: true }).from(Leaf).ownedBy(writer.address).limit(100).fetch(),
  pub.select({ txHash: true }).from(Aboard).ownedBy(writer.address).limit(100).fetch(),
]);
const seenLeaf = new Set(haveLeaves.entities.map((e) => `${e.root.value}:${e.leaf.value}:${e.digest.value}`.toLowerCase()));
const seenAboard = new Set(haveAboard.entities.map((e) => e.txHash.value.toLowerCase()));
const before = creates.length;
const fresh = creates.filter((c) =>
  c.schema === Leaf ? !seenLeaf.has(`${val(c.values.root)}:${val(c.values.leaf)}:${val(c.values.digest)}`) : c.schema === Aboard ? !seenAboard.has(val(c.values.txHash)) : true,
);
console.log(`${before - fresh.length} audit-trail entries already on Arkiv: skipped`);
const res = await client.executeBatch({ creates: fresh });
console.log(`batch tx ${res.txHash}: ${res.createdEntities.length} entities created`);
const out = { writer: writer.address, txHash: res.txHash, entities: res.createdEntities, checks, publishedAt: new Date().toISOString() };
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(repoPath("evidence", "arkiv"), { recursive: true });
writeFileSync(repoPath("evidence", "arkiv", "publish.json"), JSON.stringify(out, null, 2));
console.log(res.createdEntities.map((k, i) => `  ${fresh[i].schema.name ?? ""} ${k}`).join("\n"));
