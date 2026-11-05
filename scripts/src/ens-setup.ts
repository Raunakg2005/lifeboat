// Sepolia setup for the ENSv2 Helm check demo.
//   1. WOTS+C verifier (the same Yul core as the EIP-8141 account) + a LifeboatPQWallet for the "sepolia" key
//   2. an "old" PermissionedResolver controlled by the dev wallet (an exposed EOA), with records
//   3. register <label>.eth to the dev wallet (commit -> wait 60 s -> register, paid in Sepolia mock USDC)
//   4. make it realistically messy: an extra delegate with SET_RESOLVER and an approved operator,
//      both throwaway EOAs that have already sent a transaction (so their public keys are on-chain)
// Usage: pnpm --filter @lifeboat/scripts ens-setup [--label lifeboatpq]
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { concat, encodeAbiParameters, encodeFunctionData, formatEther, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { argValue, repoPath } from "./lib/env.js";
import { yulInitcode } from "./lib/devnet.js";
import { forgeBytecode } from "./lib/deployments.js";
import { ALL_ROLES, ENS, SEPOLIA_RPC, withStaleRetry, REGISTRY_ROLES, dnsEncode, factoryAbi, registrarAbi, registryAbi, resolverAbi, sepoliaClient, sepoliaDevWallet, usdcAbi } from "./lib/ens.js";
import { loadOrCreateKey, saveKeyFile } from "./lib/pqkey.js";

const label = argValue("--label") ?? "lifeboatpq";
const name = `${label}.eth`;
const DURATION = 2_419_200n; // 28 days, the minimum
const statePath = repoPath("deployments", "sepolia.json");
const state: Record<string, any> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { chainId: 11155111, txs: {} };
const save = () => {
  mkdirSync(repoPath("deployments"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
};

const pub = sepoliaClient();
const { account: dev, client } = sepoliaDevWallet();
console.log(`dev wallet ${dev.address}: ${formatEther(await pub.getBalance({ address: dev.address }))} Sepolia ETH, nonce ${await pub.getTransactionCount({ address: dev.address })}`);

async function send(what: string, req: { to?: Address; data?: Hex; value?: bigint; gas?: bigint }) {
  const hash = await withStaleRetry(() => client.sendTransaction({ to: req.to ?? null, data: req.data, value: req.value, gas: req.gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  state.txs[what] = hash;
  save();
  console.log(`${what}: ${hash} (block ${r.blockNumber})`);
  return r;
}

// 1. verifier + PQ wallet
const { file: key } = loadOrCreateKey("sepolia");
if (!state.verifier) state.verifier = (await send("deploy WOTS+C verifier (Yul core)", { data: yulInitcode("WotsHarness") })).contractAddress;
if (!state.pqWallet) {
  const args = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [key.root as Hex, key.pubSeed as Hex, state.verifier]);
  state.pqWallet = (await send("deploy LifeboatPQWallet", { data: concat([forgeBytecode("LifeboatPQWallet.sol", "LifeboatPQWallet"), args]) })).contractAddress;
  key.account = state.pqWallet;
  saveKeyFile(key);
}
save();

// throwaway "exposed" EOAs: funded with dust, then each sends one tx so its public key is on-chain
function throwaway(role: string) {
  const p = repoPath("secrets", `ens-${role}.json`);
  if (!existsSync(p)) {
    mkdirSync(repoPath("secrets"), { recursive: true });
    writeFileSync(p, JSON.stringify({ privateKey: `0x${randomBytes(32).toString("hex")}` }), { mode: 0o600 });
  }
  return privateKeyToAccount(JSON.parse(readFileSync(p, "utf8")).privateKey as Hex);
}
for (const role of ["delegate", "operator"]) {
  const acct = throwaway(role);
  state[role] = acct.address;
  if ((await pub.getTransactionCount({ address: acct.address })) === 0) {
    if ((await pub.getBalance({ address: acct.address })) < parseEther("0.0001")) await send(`fund ${role}`, { to: acct.address, value: parseEther("0.0002") });
    const { createWalletClient, http } = await import("viem");
    const { sepolia } = await import("viem/chains");
    const w = createWalletClient({ account: acct, chain: sepolia, transport: http(SEPOLIA_RPC()) });
    const h = await withStaleRetry(() => w.sendTransaction({ to: acct.address, value: 0n }));
    await pub.waitForTransactionReceipt({ hash: h });
    state.txs[`${role} first tx (public key now on-chain)`] = h;
    console.log(`${role} ${acct.address} sent its first tx ${h}`);
  }
}
save();

// 2. the old resolver, controlled by the dev wallet
state.oldResolvers ??= {};
if (!state.oldResolvers[label] && state.name === name && state.oldResolver) state.oldResolvers[label] = state.oldResolver;
if (!state.oldResolvers[label]) {
  const dns = dnsEncode(name);
  const init = encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [
      [{ account: dev.address, roleBitmap: ALL_ROLES }],
      [
        encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dns, 60n, dev.address] }),
        encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.status", "exposed"] }),
      ],
    ],
  });
  const salt = BigInt(keccak256(toHex(`lifeboat-old-resolver-${label}-${Date.now()}`)));
  const sim = await pub.simulateContract({ account: dev, address: ENS.VerifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [ENS.PermissionedResolverImpl, salt, init] });
  await send("deploy old resolver (dev wallet holds ALL_ROLES)", { to: ENS.VerifiableFactory, data: encodeFunctionData({ abi: factoryAbi, functionName: "deployProxy", args: [ENS.PermissionedResolverImpl, salt, init] }) });
  state.oldResolvers[label] = sim.result as Address;
  if (!state.oldResolver) state.oldResolver = sim.result as Address;
}
save();

// 3. register the name to the dev wallet (commit -> 60 s -> register)
const available = await pub.readContract({ address: ENS.ETHRegistrar, abi: registrarAbi, functionName: "isAvailable", args: [label] });
if (available) {
  const [base, premium] = (await pub.readContract({ address: ENS.ETHRegistrar, abi: registrarAbi, functionName: "getRegisterPrice", args: [label, DURATION, ENS.MockUSDC] })) as [bigint, bigint];
  const price = base + premium;
  await send(`mint ${price} mock USDC (6 dp) for the fee`, { to: ENS.MockUSDC, data: encodeFunctionData({ abi: usdcAbi, functionName: "mint", args: [dev.address, price * 2n] }) });
  await send("approve the registrar", { to: ENS.MockUSDC, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [ENS.ETHRegistrar, price * 2n] }) });
  const secret = keccak256(toHex(randomBytes(32)));
  const zero32 = `0x${"0".repeat(64)}` as Hex;
  const commitment = (await pub.readContract({
    address: ENS.ETHRegistrar,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, dev.address, secret, "0x0000000000000000000000000000000000000000", state.oldResolvers[label], DURATION, zero32],
  })) as Hex;
  await send("commit", { to: ENS.ETHRegistrar, data: encodeFunctionData({ abi: registrarAbi, functionName: "commit", args: [commitment] }) });
  console.log("waiting 70 s (MIN_COMMITMENT_AGE is 60 s)…");
  await new Promise((r) => setTimeout(r, 70_000));
  await send(`register ${name} (28 days)`, {
    to: ENS.ETHRegistrar,
    data: encodeFunctionData({ abi: registrarAbi, functionName: "register", args: [label, dev.address, secret, "0x0000000000000000000000000000000000000000", state.oldResolvers[label], DURATION, ENS.MockUSDC, zero32] }),
    gas: 1_500_000n,
  });
} else console.log(`${name} is already registered`);
if (!state.name) state.name = name; // the primary name (handed over by ens-handover)
state.demoNames = [...new Set([...(state.demoNames ?? []), ...(state.name === name ? [] : [name])])];
save();

// 4. messy but realistic: an extra delegate and an operator
const tokenId = (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "findTokenId", args: [label] })) as bigint;
const owner = (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "findOwner", args: [label] })) as Address;
console.log(`${name}: tokenId ${tokenId}, owner ${owner}`);
if (owner.toLowerCase() === dev.address.toLowerCase()) {
  const has = (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "hasRoles", args: [tokenId, REGISTRY_ROLES.SET_RESOLVER!, state.delegate] })) as boolean;
  if (!has) await send("grant SET_RESOLVER to an extra delegate", { to: ENS.ETHRegistry, data: encodeFunctionData({ abi: registryAbi, functionName: "grantRoles", args: [tokenId, REGISTRY_ROLES.SET_RESOLVER!, state.delegate] }) });
  const approved = (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "isApprovedForAll", args: [dev.address, state.operator] })) as boolean;
  if (!approved) await send("approve an operator for all names", { to: ENS.ETHRegistry, data: encodeFunctionData({ abi: registryAbi, functionName: "setApprovalForAll", args: [state.operator, true] }) });
}
save();
console.log({ name, pqWallet: state.pqWallet, verifier: state.verifier, oldResolver: state.oldResolvers[label], delegate: state.delegate, operator: state.operator });
