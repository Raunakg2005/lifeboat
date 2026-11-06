// Protect an ENSv2 name with a hardware post-quantum key. Browser-safe: used by the app's Protect tab and by
// scripts/src/ens-hw-handover.ts.
//
// The device's key (root, pubSeed) gets its own LifeboatPQWallet, deployed with CREATE2 so its address follows from
// the key alone: anyone who reads the device's public key can find the wallet again, and nothing has to be saved.
// The handover is the registry-verified one from docs/helm-check.md:
//   1. a fresh PermissionedResolver where only the PQ wallet holds roles (pq.* records set at init)
//   2. point the name at it (the old resolver's role holders stop mattering)
//   3. revoke every other registry role holder on the name, 4. remove the owner's operators
//   5. transfer the name to the PQ wallet (ENSv2 refuses this while other assignees remain)
// From then on every change is a PQ-wallet `execute` signed on the device (clear-signed: it shows the call in words).
import { concat, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, keccak256, toHex, type Address, type Hex } from "viem";
import walletArtifact from "../abi/LifeboatPQWallet.bytecode.json" with { type: "json" };
import { ALL_ROLES, ENS, dnsEncode, factoryAbi, registryAbi, resolverAbi } from "./ens.js";
import type { HelmReport } from "./helm.js";
import type { WalletCall } from "./device.js";

/** The deterministic CREATE2 deployer (same address on every chain). */
export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
/** The WOTS+C verifier on Sepolia (deployments/sepolia.json → verifier). */
export const SEPOLIA_WOTS_VERIFIER: Address = "0x98cd804ae58ea5fc9fa4fb403f6d0d88acdd0ac8";
export const PQ_SCHEME = "WOTS+C-keccak-w16-S560-h8";

export const pqWalletAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "leaf", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] },
      { name: "witness", type: "bytes" },
    ],
    outputs: [],
  },
  { type: "function", name: "isLeafUsed", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "usedLeaves", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "root", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "pubSeed", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

const walletInitcode = (root: Hex, pubSeed: Hex, verifier: Address): Hex =>
  concat([walletArtifact.bytecode as Hex, encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [root, pubSeed, verifier])]);

/** The PQ wallet address for a device key: CREATE2 with salt = root, so it follows from the public key alone. */
export function pqWalletAddress(root: Hex, pubSeed: Hex, verifier: Address = SEPOLIA_WOTS_VERIFIER): Address {
  return getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: root, bytecode: walletInitcode(root, pubSeed, verifier) });
}

/** The transaction that deploys it (anyone can send it; the deployer gets no control). */
export function deployPqWalletTx(root: Hex, pubSeed: Hex, verifier: Address = SEPOLIA_WOTS_VERIFIER): { to: Address; data: Hex } {
  return { to: CREATE2_DEPLOYER, data: concat([root, walletInitcode(root, pubSeed, verifier)]) };
}

/** initialize() for the new resolver: only the PQ wallet holds roles; the address and pq.* records are set at init. */
export function resolverInitData(name: string, pqWallet: Address, root: Hex, checkedAt: string): Hex {
  const dns = dnsEncode(name);
  const text = (key: string, value: string) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, key, value] });
  return encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [
      [{ account: pqWallet, roleBitmap: ALL_ROLES }],
      [
        encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dns, 60n, pqWallet] }),
        text("pq.status", "protected"),
        text("pq.scheme", PQ_SCHEME),
        text("pq.root", root),
        text("pq.account", pqWallet),
        text("pq.signer", "hardware (ESP32, clear signing)"),
        text("pq.checked", checkedAt),
      ],
    ],
  });
}

/** A salt for VerifiableFactory.deployProxy, unique per name and attempt. */
export const resolverSalt = (name: string, nonce: string | number) => BigInt(keccak256(toHex(`lifeboat-hw-resolver-${name}-${nonce}`)));

export const deployResolverTx = (salt: bigint, init: Hex) => ({
  to: ENS.VerifiableFactory as Address,
  data: encodeFunctionData({ abi: factoryAbi, functionName: "deployProxy", args: [ENS.PermissionedResolverImpl, salt, init] }),
});

/** Who besides the owner (and the PQ wallet) can steer the name through the registry: what the handover removes. */
export function extraHolders(report: HelmReport, pqWallet: Address): { delegates: Address[]; operators: Address[] } {
  const skip = new Set([report.owner.toLowerCase(), pqWallet.toLowerCase()]);
  const pick = (path: number) => [...new Set(report.entries.filter((e) => e.path === path).map((e) => getAddress(e.holder.address)))].filter((a) => !skip.has(a.toLowerCase()));
  return { delegates: pick(2), operators: pick(3) };
}

export type HandoverStep =
  | { kind: "resolver"; title: string }
  | { kind: "setResolver"; title: string }
  | { kind: "revoke"; title: string; account: Address }
  | { kind: "operator"; title: string; account: Address }
  | { kind: "transfer"; title: string };

/** The ordered steps for this name, in words. Each is one transaction from the current owner. */
export function handoverPlan(report: HelmReport, pqWallet: Address): HandoverStep[] {
  const { delegates, operators } = extraHolders(report, pqWallet);
  const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  return [
    { kind: "resolver", title: "Deploy a fresh resolver that only the post-quantum wallet controls (pq.* records set at creation)" },
    { kind: "setResolver", title: "Point the name at it (the old resolver's role holders stop mattering)" },
    ...delegates.map((account) => ({ kind: "revoke" as const, title: `Revoke the registry roles of delegate ${short(account)}`, account })),
    ...operators.map((account) => ({ kind: "operator" as const, title: `Remove operator ${short(account)} (it could transfer all your names)`, account })),
    { kind: "transfer", title: "Transfer the name to the post-quantum wallet (ENSv2 accepts it once nobody else holds a role)" },
  ];
}

export const setResolverData = (tokenId: bigint, resolver: Address): Hex => encodeFunctionData({ abi: registryAbi, functionName: "setResolver", args: [tokenId, resolver] });
export const revokeRolesData = (tokenId: bigint, bitmap: bigint, account: Address): Hex => encodeFunctionData({ abi: registryAbi, functionName: "revokeRoles", args: [tokenId, bitmap, account] });
export const removeOperatorData = (operator: Address): Hex => encodeFunctionData({ abi: registryAbi, functionName: "setApprovalForAll", args: [operator, false] });
export const transferNameData = (from: Address, to: Address, tokenId: bigint): Hex =>
  encodeFunctionData({ abi: registryAbi, functionName: "safeTransferFrom", args: [from, to, tokenId, 1n, "0x"] });

/** The calls for one record change, made by the PQ wallet (shown on the device as "setText · name … · key … = …"). */
export function setTextCalls(resolver: Address, name: string, key: string, value: string): WalletCall[] {
  return [{ target: resolver, value: 0n, data: encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode(name), key, value] }) }];
}
export function setAddressCalls(resolver: Address, name: string, address: Address): WalletCall[] {
  return [{ target: resolver, value: 0n, data: encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dnsEncode(name), 60n, address] }) }];
}

export const executeData = (leaf: number, deadline: bigint, calls: WalletCall[], witness: Hex): Hex =>
  encodeFunctionData({ abi: pqWalletAbi, functionName: "execute", args: [BigInt(leaf), deadline, calls, witness] });
