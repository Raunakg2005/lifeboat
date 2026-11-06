/// <reference lib="dom" />
// End-to-end test of the app's Protect tab on Sepolia, driven like a user.
// Chrome (playwright-core) opens the app; a test wallet is injected as window.ethereum: an EIP-1193 provider
// backed by a throwaway key in secrets/e2e-owner.json (gitignored, never printed) that signs and sends like a
// browser wallet. The script clicks through: connect, create a post-quantum key, load a fresh Safe owned by the
// test wallet, install Quantum Guard, co-sign a payment, start a recovery as the owners, veto it with the PQ key.
// Then it checks the chain. Testnet only.
// Needs the app running (pnpm --filter @lifeboat/app dev) and Google Chrome.
// Usage: pnpm --filter @lifeboat/scripts e2e-protect [--url http://localhost:5173] [--headed]
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, encodeFunctionData, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { chromium } from "playwright-core";
import { GUARD_SLOT, HANDLER_SLOT, SAFE_141, ZERO_ADDRESS, quantumGuardAbi, safeAbi, safeFactoryAbi, slotAddress } from "@lifeboat/core";
import { argValue, hasFlag, repoPath } from "./lib/env.js";
import { SEPOLIA_RPC, sepoliaClient, sepoliaDevWallet, withStaleRetry } from "./lib/ens.js";

const URL0 = (argValue("--url") ?? "http://localhost:5173").replace(/\/+$/, "");
const OUT = repoPath("evidence", "e2e");
mkdirSync(OUT, { recursive: true });
const report: Record<string, any> = { startedAt: new Date().toISOString(), chainId: 11155111, txs: [] as any[], steps: [] as any[], checks: {} };
const pub = sepoliaClient();

// ---------------------------------------------------------------- the test wallet (throwaway key, testnet only)
const keyFile = repoPath("secrets", "e2e-owner.json");
if (!existsSync(keyFile)) {
  mkdirSync(repoPath("secrets"), { recursive: true });
  writeFileSync(keyFile, JSON.stringify({ privateKey: `0x${randomBytes(32).toString("hex")}` }), { mode: 0o600 });
}
const owner = privateKeyToAccount(JSON.parse(readFileSync(keyFile, "utf8")).privateKey as Hex);
const ownerWallet = createWalletClient({ account: owner, chain: sepolia, transport: http(SEPOLIA_RPC(), { retryCount: 3, timeout: 30_000 }) });
const { account: dev, client: devClient } = sepoliaDevWallet();
report.testOwner = owner.address;

async function devSend(what: string, req: { to: Address; data?: Hex; value?: bigint }) {
  const hash = await withStaleRetry(() => devClient.sendTransaction({ ...req } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  report.txs.push({ by: "setup (dev wallet)", what, hash, block: r.blockNumber.toString() });
  console.log(`setup: ${what} (block ${r.blockNumber})`);
  return r;
}

// ---------------------------------------------------------------- setup: fund the test owner, a fresh Safe it owns
if ((await pub.getBalance({ address: owner.address })) < parseEther("0.03")) await devSend("fund the test owner (0.04 ETH)", { to: owner.address, value: parseEther("0.04") });
const init = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[owner.address], 1n, ZERO_ADDRESS, "0x", SAFE_141.fallbackHandler, ZERO_ADDRESS, 0n, ZERO_ADDRESS] });
const salt = BigInt(Date.now());
const { result: safe } = await pub.simulateContract({ account: dev, address: SAFE_141.factory, abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, init, salt] });
await devSend("create a fresh Safe 1.4.1 owned by the test wallet", { to: SAFE_141.factory, data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, init, salt] }) });
await devSend("fund the Safe (0.001 ETH)", { to: safe, value: parseEther("0.001") });
report.safe = safe;
console.log(`test owner ${owner.address} (${formatEther(await pub.getBalance({ address: owner.address }))} ETH) · Safe ${safe}`);

// ---------------------------------------------------------------- the injected wallet (EIP-1193), handled here
const toBig = (v: unknown) => (typeof v === "string" || typeof v === "number" ? BigInt(v) : v);
function typedDataFromJson(json: string) {
  const td = JSON.parse(json);
  delete td.types.EIP712Domain;
  for (const f of td.types[td.primaryType] as { name: string; type: string }[]) if (/^u?int/.test(f.type)) td.message[f.name] = toBig(td.message[f.name]);
  if (td.domain.chainId !== undefined) td.domain.chainId = Number(td.domain.chainId);
  return td;
}
let pendingLabel = "app transaction";
async function handle(method: string, params: any[]) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [owner.address];
    case "eth_chainId":
      return "0xaa36a7";
    case "net_version":
      return "11155111";
    case "wallet_switchEthereumChain":
      return null;
    case "eth_signTypedData_v4":
      return owner.signTypedData(typedDataFromJson(params[1]));
    case "eth_sendTransaction": {
      const t = params[0];
      const hash = await withStaleRetry(() =>
        ownerWallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, gas: t.gas ? BigInt(t.gas) : undefined } as any),
      );
      report.txs.push({ by: "app (test wallet)", what: pendingLabel, hash });
      return hash;
    }
    default:
      return pub.request({ method: method as any, params: params as any });
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: !hasFlag("--headed") });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.exposeFunction("__e2eWallet", async (method: string, params: any[]) => {
  try {
    return { ok: true, value: JSON.parse(JSON.stringify(await handle(method, params ?? []), (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v))) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 300) };
  }
});
// plain JavaScript text: tsx wraps functions with helpers (__name) that don't exist inside the page
await ctx.addInitScript({
  content: `
    window.ethereum = {
      isMetaMask: true,
      request: async function (args) {
        const r = await window.__e2eWallet(args.method, args.params || []);
        if (!r.ok) throw new Error(r.error);
        return r.value;
      },
      on: function () {},
      removeListener: function () {},
    };`,
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

let n = 0;
async function step(name: string, f: () => Promise<void>, timeout = 180_000) {
  const t0 = Date.now();
  pendingLabel = name;
  process.stdout.write(`${name} … `);
  await Promise.race([f(), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeout / 1000} s`)), timeout))]);
  const box = await page.locator(".error-box").first().textContent({ timeout: 500 }).catch(() => null);
  if (box) throw new Error(`the app shows an error: ${box}`);
  const secs = (Date.now() - t0) / 1000;
  await page.screenshot({ path: `${OUT}/protect-${String(++n).padStart(2, "0")}.png` });
  report.steps.push({ name, secs });
  console.log(`ok (${secs.toFixed(1)} s)`);
}
const row = (label: string) => page.locator(".qrows > div", { hasText: label }).first();
const waitText = (loc: ReturnType<typeof page.locator>, re: RegExp, timeout = 180_000) =>
  loc.filter({ hasText: re }).first().waitFor({ timeout });

try {
  await page.goto(`${URL0}/#protect`);
  await page.evaluate(() => document.fonts.ready);
  await step("connect the wallet", async () => {
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await waitText(page.locator(".protect-steps .paper-card"), /Sepolia/, 30_000);
  });
  await step("create a post-quantum key in the browser", async () => {
    await page.getByRole("button", { name: "Create a key" }).click();
    await waitText(page.locator(".protect-steps .paper-card"), /next leaf 0/, 90_000);
  });
  await step("load the Safe", async () => {
    await page.getByLabel("Safe address on Sepolia").fill(safe);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await waitText(page.locator(".qrows > div"), /you are an owner/, 60_000);
  });
  await step("install Quantum Guard (factory + one Safe transaction)", async () => {
    await page.getByRole("button", { name: "Install Quantum Guard" }).click();
    await waitText(page.locator(".qrows > div"), /matches the guard/);
  });
  await step("co-sign and send a payment", async () => {
    await page.getByPlaceholder("0x… recipient").fill(owner.address);
    await page.getByLabel("ETH amount").fill("0.0001");
    await page.getByRole("button", { name: /Co-sign/ }).click();
    await waitText(page.locator(".protect-log li"), /pay 0\.0001 ETH: included/);
  });
  await step("owners start a recovery", async () => {
    await page.getByRole("button", { name: "Start (owners)" }).click();
    await waitText(row("Recovery"), /pending/);
  });
  await step("veto it with the post-quantum key", async () => {
    await page.getByRole("button", { name: "Veto (PQ key)" }).click();
    await waitText(page.locator(".protect-log li"), /cancelled with PQ leaf/);
    await waitText(row("Recovery"), /none/, 60_000);
  });

  // ---------------------------------------------------------------- what the chain says
  await new Promise((r) => setTimeout(r, 4000));
  const guard = slotAddress(await pub.getStorageAt({ address: safe, slot: GUARD_SLOT }));
  const handler = slotAddress(await pub.getStorageAt({ address: safe, slot: HANDLER_SLOT }));
  const r = (fn: string) => pub.readContract({ address: guard, abi: quantumGuardAbi, functionName: fn as any });
  const [used, readyAt, rnonce, root] = (await Promise.all([r("usedLeaves"), r("recoveryReadyAt"), r("recoveryNonce"), r("root")])) as [bigint, bigint, bigint, Hex];
  const nonce = (await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" })) as bigint;
  const browserRoot = await page.evaluate(() => JSON.parse(localStorage.getItem("lifeboat.pq-guard-key.v1") ?? "{}").root);
  report.checks = {
    guardInstalled: BigInt(guard) !== 0n,
    handlerIsGuard: handler === guard,
    guardUsesTheBrowserKey: String(root).toLowerCase() === String(browserRoot).toLowerCase(),
    leavesUsed: used.toString(2).split("").filter((b) => b === "1").length,
    recoveryAttempts: Number(rnonce),
    recoveryPending: readyAt !== 0n,
    safeNonce: Number(nonce),
    pageErrors: errors,
  };
  report.guard = guard;
  const c = report.checks;
  report.passed = c.guardInstalled && c.handlerIsGuard && c.guardUsesTheBrowserKey && c.leavesUsed === 2 && c.recoveryAttempts === 1 && !c.recoveryPending && c.safeNonce === 3 && errors.length === 0;
} catch (e) {
  report.passed = false;
  report.error = String((e as Error).message).split("\n")[0];
  await page.screenshot({ path: `${OUT}/protect-failure.png` }).catch(() => {});
  console.log(`FAILED: ${report.error}`);
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
for (const t of report.txs) if (!t.block) t.block = (await pub.getTransactionReceipt({ hash: t.hash }).catch(() => null))?.blockNumber?.toString();
writeFileSync(`${OUT}/protect.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks));
console.log(report.passed ? "PASSED: every step worked through the real page, and the chain agrees" : "NOT PASSED: see evidence/e2e/protect.json");
process.exit(report.passed ? 0 : 1);
