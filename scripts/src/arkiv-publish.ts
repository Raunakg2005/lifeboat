// Publisher: re-verifies each claim on-chain, then writes it to the public Q-Day registry on Arkiv in one batch.
// Nothing is published from a file alone: every entry is checked against the chain it describes first.
// Re-checks update the publisher's live Exposure / NameCheck record in place (stable keys, expiry extended);
// the readonly audit trail (Leaf, Aboard) is written once. See lib/publish.ts.
// Usage: pnpm --filter @lifeboat/scripts arkiv-publish [--dry-run] [--skip-names] [--skip-key-files]
//   --dry-run         every read and check, then print the planned creates / updates / extensions; sends nothing
//   --skip-key-files  leave out the Leaf and Aboard entries, which need the public parts (root, leaf log) of
//                     secrets/pq-key-*.json; for a dry run on a machine without them
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { formatEther, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { hasFlag, repoPath } from "./lib/env.js";
import { publicClient as devnetClient } from "./lib/devnet.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";
import { helmCheck } from "@lifeboat/core";
import { Aboard, CHECKER, EXPIRY, Exposure, Leaf, NameCheck, arkivClient } from "./lib/arkiv.js";
import { planWrites, printPlan, printSent, sendPlan, type Write } from "./lib/publish.js";
import { loadOrCreateKey } from "./lib/pqkey.js";

const dry = hasFlag("--dry-run") || hasFlag("--dry");
const skipKeyFiles = hasFlag("--skip-key-files");
const SCHEME = "WOTS+C-keccak-w16-S560-h8";
const ev = (p: string) => JSON.parse(readFileSync(repoPath(...p.split("/")), "utf8"));
const devnet = devnetClient() as unknown as PublicClient;
const sepolia = sepoliaClient() as unknown as PublicClient;
const checks: { claim: string; ok: boolean; detail: string }[] = [];
// a failed check stops the real run before anything is sent; a dry run notes it and carries on, to show every check
const verify = (claim: string, ok: boolean, detail: string) => {
  checks.push({ claim, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${claim}: ${detail}`);
  if (!ok && !dry) throw new Error(`refusing to publish: ${claim} did not verify`);
};
const receiptOk = async (c: PublicClient, hash: Hex) => (await c.getTransactionReceipt({ hash }).catch(() => null))?.status === "success";
const AUDIT = { readonly: true, permissionlessExtension: true };

const writes: Write[] = [];
const skipped: string[] = [];

// ---- chain 1337: the EIP-8141 LifeboatAccount and the rescue ----
const demo = skipKeyFiles ? null : loadOrCreateKey("demo").file;
const first = ev("evidence/ef/frame-demo-leaf2.json"); // re-run after the devnet reset (6 Nov); the first run is in evidence/ef/before-reset/
const account = getAddress(demo?.account ?? first.account);
verify(`frame tx with leaf ${first.leaf} landed`, await receiptOk(devnet, first.txHash), `${first.txHash} on chain 1337`);
const floor = BigInt((await devnet.getStorageAt({ address: account, slot: "0x2" })) ?? "0x0");
verify(`on-chain leaf floor is past leaf ${first.leaf}`, floor >= BigInt(first.leaf) + 2n, `slot 2 = ${floor} (lowest usable leaf ${floor - 1n})`);
const sim0 = ev("evidence/ef/before-reset/simulate-demo-leaf0.json");
if (demo) {
  writes.push({ schema: Leaf, values: { root: demo.root, leaf: u64(BigInt(first.leaf)), account: addr(account), chainId: u64(1337n), digest: first.sigHash, txHash: first.txHash }, expiration: EXPIRY.leaf(), flags: AUDIT });
  writes.push({ schema: Leaf, values: { root: demo.root, leaf: u64(0n), account: addr(account), chainId: u64(1337n), digest: sim0.sigHash, txHash: "dry-run: revealed to ethrex_simulateFrameTransaction" }, expiration: EXPIRY.leaf(), flags: AUDIT });
} else skipped.push(`Leaf 1337 leaf ${first.leaf}`, "Leaf 1337 leaf 0");

const rescue = ev("evidence/ef/rescue.json");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
verify("rescue sweep landed", await receiptOk(devnet, rescue.altStaked.hash), `${rescue.altStaked.hash} (sponsored by ${rescue.paymaster})`);
const leftover = await devnet.readContract({ address: rescue.usdc, abi: usdcAbi, functionName: "balanceOf", args: [rescue.sender] }).catch(() => null); // null: mUSDC not readable
verify("the exposed wallet's tokens are gone", leftover === 0n, leftover === null ? `mUSDC ${rescue.usdc} not readable on chain 1337` : `${rescue.sender} holds ${leftover} mUSDC`);
if (demo)
  writes.push({
    schema: Aboard,
    values: { from: addr(getAddress(rescue.sender)), to: addr(account), chainId: u64(1337n), kind: "rescue-sweep", scheme: SCHEME, root: demo.root, txHash: rescue.altStaked.hash, note: "0-ETH wallet swept 99 mUSDC; gas paid by a staked paymaster, repaid 1 mUSDC" },
    expiration: EXPIRY.aboard(),
    flags: AUDIT,
  });
else skipped.push("Aboard rescue-sweep");

// ---- Sepolia: the PQ wallet, its first leaf, and the ENS handover ----
const sep = ev("deployments/sepolia.json");
const sepKey = skipKeyFiles ? null : loadOrCreateKey("sepolia").file;
const pqWallet = getAddress(sep.pqWallet);
const handover = ev("evidence/ens/handover.json");
const step = (n: string) => handover.steps.find((s: any) => s.what.startsWith(n));
const pqTx = step("7.").hash as Hex;
verify("PQ wallet's WOTS-signed setText landed", await receiptOk(sepolia, pqTx), pqTx);
const leaf0Used = await sepolia.readContract({ address: pqWallet, abi: parseAbi(["function isLeafUsed(uint256) view returns (bool)"]), functionName: "isLeafUsed", args: [0n] });
verify("Sepolia PQ wallet marks leaf 0 used", leaf0Used, `isLeafUsed(0) = ${leaf0Used}`);
if (sepKey) {
  const sepLeafLog = sepKey.log.find((l) => l.leaf === 0)!;
  writes.push({ schema: Leaf, values: { root: sepKey.root, leaf: u64(0n), account: addr(pqWallet), chainId: u64(11155111n), digest: sepLeafLog.sigHash, txHash: pqTx }, expiration: EXPIRY.leaf(), flags: AUDIT });
} else skipped.push("Leaf 11155111 leaf 0");

const name: string = sep.name;
const report = await helmCheck(sepolia, sepoliaLogsClient() as any, [mainnetClient() as any], name, { pqWallets: [pqWallet] });
verify(`fresh Helm check of ${name}`, report.verdict === "protected" && report.owner === pqWallet, `verdict ${report.verdict}, owner ${report.owner}, block ${report.block}`);
if (sepKey)
  writes.push({
    schema: Aboard,
    values: { from: addr(getAddress(sep.oldOwner ?? "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a")), to: addr(pqWallet), chainId: u64(11155111n), kind: "ens-handover", scheme: SCHEME, root: sepKey.root, txHash: step("6.").hash, note: `${name}: registry-verified handover, new resolver, delegate and operator removed` },
    expiration: EXPIRY.aboard(),
    flags: AUDIT,
  });
else skipped.push("Aboard ens-handover");
// no Swarm file here: if the live record carries an older swarmRef / evidenceHash, the update unsets them
if (!hasFlag("--skip-names")) writes.push({ schema: NameCheck, values: { name, chainId: u64(11155111n), verdict: report.verdict, owner: addr(report.owner), paths: report.hijackablePaths.join(",") || "-", checkedBlock: u64(report.block) }, expiration: EXPIRY.name() });

// ---- exposure attestations for every address in the demo ----
async function exposure(c: PublicClient, chainId: bigint, a: Address, knownPq: boolean) {
  const [code, nonce, bal, block] = await Promise.all([c.getCode({ address: a }), c.getTransactionCount({ address: a }), c.getBalance({ address: a }), c.getBlockNumber()]);
  const status = knownPq ? "pq" : code && code !== "0x" ? "contract" : nonce > 0 ? "exposed" : "not-seen";
  const evidence = status === "exposed" ? `nonce ${nonce} at block ${block}: public key recoverable from any of its txs` : status === "pq" ? "hash-based (WOTS+C) account" : `nonce ${nonce}`;
  console.log(`   exposure ${a} on ${chainId}: ${status} (${formatEther(bal)} ETH)`);
  writes.push({ schema: Exposure, values: { address: addr(a), chainId: u64(chainId), status, via: status === "pq" ? "code" : "nonce", ethAtRisk: dec(status === "exposed" ? formatEther(bal) : "0"), checkedBlock: u64(block), evidence, checker: CHECKER }, expiration: EXPIRY.exposure() });
}
await exposure(devnet, 1337n, account, true);
await exposure(devnet, 1337n, getAddress(rescue.sender), false);
await exposure(sepolia, 11155111n, pqWallet, true);
for (const a of [sep.delegate, sep.operator, "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a"]) await exposure(sepolia, 11155111n, getAddress(a), false);

console.log(`\n${writes.length} entries prepared; ${checks.filter((c) => c.ok).length}/${checks.length} on-chain checks passed`);
if (skipped.length) console.log(`left out (--skip-key-files): ${skipped.join(", ")}`);

const arkiv = arkivClient();
const plan = await planWrites(writes, arkiv.owner, arkiv.reader);
printPlan(plan, dry ? "DRY RUN: Arkiv plan" : "Arkiv plan");
if (dry) {
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) console.log(`\n❌ ${failed.length} check(s) failed: the real run would stop at "${failed[0]!.claim}" and send nothing`);
  console.log("\ndry run: nothing sent");
  process.exit(0);
}
if (!arkiv.writer) throw new Error("DEV_PRIVATE_KEY is not set: run with --dry-run, or load .env");

console.log(`writer ${arkiv.owner}: ${formatEther(await arkiv.reader.getBalance({ address: arkiv.owner }))} tGLM`);
const sent = await sendPlan(plan, arkiv.writer);
printSent(sent);
if (sent.txHash) {
  const out = { writer: arkiv.owner, txHash: sent.txHash, created: sent.created, updated: sent.updated, extended: sent.extended, unchanged: sent.unchanged, checks, publishedAt: new Date().toISOString() };
  mkdirSync(repoPath("evidence", "arkiv"), { recursive: true });
  writeFileSync(repoPath("evidence", "arkiv", "publish.json"), JSON.stringify(out, null, 2));
  console.log("saved evidence/arkiv/publish.json");
}
