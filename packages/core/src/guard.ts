// Safe 1.4.1 + QuantumGuard, shared by the scripts and the app (browser-safe: viem only).
// The Safe transaction hash, the Safe message data, the digest the guard's WOTS+C key signs, the ABIs, the
// MultiSend encoding for a one-transaction install, and the storage slots where a Safe keeps its guard and handler.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, hashTypedData, keccak256, numberToHex, parseAbi, size, type Address, type Hex } from "viem";

/** Canonical Safe 1.4.1 deployments (same address on every chain). */
export const SAFE_141 = {
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  multiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
} as const;
export const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as Hex; // keccak256("guard_manager.guard.address")
export const HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex; // keccak256("fallback_manager.handler.address")
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function setGuard(address guard)",
  "function setFallbackHandler(address handler)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
export const safeFactoryAbi = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
export const multiSendAbi = parseAbi(["function multiSend(bytes transactions) payable"]);
export const quantumGuardAbi = parseAbi([
  "function safe() view returns (address)",
  "function root() view returns (bytes32)",
  "function pubSeed() view returns (bytes32)",
  "function usedLeaves() view returns (uint256)",
  "function isLeafUsed(uint256 leaf) view returns (bool)",
  "function recoveryDelay() view returns (uint256)",
  "function recoveryNonce() view returns (uint256)",
  "function recoveryReadyAt() view returns (uint256)",
  "function recovered() view returns (bool)",
  "function approveMessage(bytes32 dataHash, bytes witness)",
  "function cancelRecovery(bytes witness)",
  "function startRecovery()",
  "function finishRecovery()",
  "function rotate(bytes32 newRoot, bytes32 newPubSeed, bytes witness)",
  "event PQCoSigned(bytes32 indexed safeTxHash, uint256 leaf)",
  "event RecoveryStarted(uint256 indexed nonce, uint256 readyAt)",
  "event RecoveryCancelled(uint256 indexed nonce, uint256 leaf)",
  "event Recovered(uint256 indexed nonce)",
  "error NotTheSafe()",
  "error MissingPQSignature()",
  "error LeafOutOfRange(uint256 leaf)",
  "error LeafUsed(uint256 leaf)",
  "error BadPQSignature()",
  "error NoRecovery()",
  "error RecoveryNotReady(uint256 readyAt)",
]);
export const guardFactoryAbi = parseAbi([
  "function verifier() view returns (address)",
  "function predict(address safe, bytes32 root, bytes32 pubSeed, uint256 recoveryDelay) view returns (address)",
  "function deploy(address safe, bytes32 root, bytes32 pubSeed, uint256 recoveryDelay) returns (address guard)",
  "event GuardDeployed(address indexed safe, address guard, bytes32 root, uint256 recoveryDelay)",
]);

export type SafeTx = {
  to: Address;
  value: bigint;
  data: Hex;
  operation: number;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
};

export const simpleSafeTx = (to: Address, value: bigint, data: Hex, nonce: bigint, operation = 0): SafeTx => ({
  to,
  value,
  data,
  operation,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: ZERO_ADDRESS,
  refundReceiver: ZERO_ADDRESS,
  nonce,
});

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** EIP-712 typed data for a Safe transaction (what an owner's wallet signs). */
export const safeTypedData = (chainId: number, safe: Address, tx: SafeTx) => ({
  domain: { chainId, verifyingContract: safe },
  types: SAFE_TX_TYPES,
  primaryType: "SafeTx" as const,
  message: tx,
});

/** Safe 1.4.1 getTransactionHash. */
export const safeTxHash = (chainId: number, safe: Address, tx: SafeTx): Hex => hashTypedData(safeTypedData(chainId, safe, tx));

/** execTransaction calldata: the owners' signatures (sorted by owner), then the PQ witness if the guard is on. */
export const execTransactionData = (tx: SafeTx, signatures: Hex) =>
  encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures] });

/** MultiSendCallOnly payload: each call = operation(0) ‖ to ‖ value ‖ data length ‖ data. */
export function multiSendData(calls: { to: Address; value?: bigint; data: Hex }[]): Hex {
  const packed = concat(calls.map((c) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, c.value ?? 0n, BigInt(size(c.data)), c.data])));
  return encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] });
}

/** One Safe transaction that installs a guard as both the transaction guard and the fallback handler. */
export const installGuardTx = (safe: Address, guard: Address, nonce: bigint): SafeTx =>
  simpleSafeTx(
    SAFE_141.multiSendCallOnly,
    0n,
    multiSendData([
      { to: safe, data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [guard] }) },
      { to: safe, data: encodeFunctionData({ abi: safeAbi, functionName: "setFallbackHandler", args: [guard] }) },
    ]),
    nonce,
    1, // delegatecall into MultiSendCallOnly, so both calls come from the Safe itself
  );

/** Safe owner signatures must be sorted by owner address (ascending). */
export const sortSignatures = (sigs: { owner: Address; signature: Hex }[]): Hex =>
  concat([...sigs].sort((a, b) => (BigInt(a.owner) < BigInt(b.owner) ? -1 : 1)).map((s) => s.signature));

/** Safe's EIP-712 domain separator. */
export const safeDomainSeparator = (chainId: number, safe: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }], [keccak256(new TextEncoder().encode("EIP712Domain(uint256 chainId,address verifyingContract)")), BigInt(chainId), safe]));

/** The Safe message data for an ERC-1271 dataHash (as Safe's CompatibilityFallbackHandler encodes it). */
export function safeMessageData(chainId: number, safe: Address, dataHash: Hex): Hex {
  const typehash = keccak256(new TextEncoder().encode("SafeMessage(bytes message)"));
  const inner = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [typehash, keccak256(encodeAbiParameters([{ type: "bytes32" }], [dataHash]))]));
  return encodePacked(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", safeDomainSeparator(chainId, safe), inner]);
}

export const GUARD_KIND = { tx: 0, message: 1, rotate: 2, cancelRecovery: 3 } as const;

/** What the PQ key signs to cancel recovery attempt `nonce`. */
export const cancelRecoveryHash = (nonce: bigint): Hex => keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["CANCEL_RECOVERY", nonce]));

/** keccak256(abi.encode("LIFEBOAT_QUANTUM_GUARD_V1", kind, chainid, guard, safe, h)): what the guard's WOTS+C key signs. */
export const guardDigest = (chainId: number, guard: Address, safe: Address, kind: number, h: Hex): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      ["LIFEBOAT_QUANTUM_GUARD_V1", kind, BigInt(chainId), guard, safe, h],
    ),
  );

/** The address in a 32-byte storage word (the Safe's guard / handler slots). */
export const slotAddress = (word: Hex | undefined): Address => `0x${(word ?? numberToHex(0, { size: 32 })).slice(-40)}`.toLowerCase() as Address;
