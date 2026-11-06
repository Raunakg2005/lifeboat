// Off-chain side of contracts/src/QuantumGuard.sol: the Safe transaction hash, the Safe message data, and the
// digest the guard's WOTS+C key signs.
import { encodeAbiParameters, encodePacked, hashTypedData, keccak256, type Address, type Hex } from "viem";

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

export const safeTypedData = (chainId: number, safe: Address, tx: SafeTx) => ({
  domain: { chainId, verifyingContract: safe },
  types: SAFE_TX_TYPES,
  primaryType: "SafeTx" as const,
  message: tx,
});

/** Safe 1.4.1 getTransactionHash (EIP-712, domain = chainId + verifyingContract). */
export const safeTxHash = (chainId: number, safe: Address, tx: SafeTx): Hex => hashTypedData(safeTypedData(chainId, safe, tx));

/** Safe's EIP-712 domain separator. */
export const safeDomainSeparator = (chainId: number, safe: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }], [keccak256(new TextEncoder().encode("EIP712Domain(uint256 chainId,address verifyingContract)")), BigInt(chainId), safe]));

/** The Safe message data for an ERC-1271 dataHash (as Safe's CompatibilityFallbackHandler encodes it). */
export function safeMessageData(chainId: number, safe: Address, dataHash: Hex): Hex {
  const typehash = keccak256(new TextEncoder().encode("SafeMessage(bytes message)"));
  const inner = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [typehash, keccak256(encodeAbiParameters([{ type: "bytes32" }], [dataHash]))]));
  return encodePacked(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", safeDomainSeparator(chainId, safe), inner]);
}

export const KIND = { tx: 0, message: 1, rotate: 2, cancelRecovery: 3 } as const;

/** What the PQ key signs to cancel recovery attempt `nonce`: keccak256(abi.encode("CANCEL_RECOVERY", nonce)). */
export const cancelRecoveryHash = (nonce: bigint): Hex => keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["CANCEL_RECOVERY", nonce]));

/** keccak256(abi.encode("LIFEBOAT_QUANTUM_GUARD_V1", kind, chainid, guard, safe, h)) */
export const guardDigest = (chainId: number, guard: Address, safe: Address, kind: number, h: Hex): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
      ["LIFEBOAT_QUANTUM_GUARD_V1", kind, BigInt(chainId), guard, safe, h],
    ),
  );
