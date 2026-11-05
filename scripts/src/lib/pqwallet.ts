// Off-chain side of contracts/src/LifeboatPQWallet.sol: the digest the WOTS+C key signs.
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export type Call = { target: Address; value: bigint; data: Hex };

export const callsAbiType = [
  { type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] },
] as const;

/** keccak256(abi.encode("LIFEBOAT_PQ_V1", chainid, wallet, leaf, deadline, keccak256(abi.encode(calls)))) */
export function walletDigest(chainId: bigint, wallet: Address, leaf: bigint, deadline: bigint, calls: Call[]): Hex {
  const callsHash = keccak256(encodeAbiParameters(callsAbiType, [calls]));
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      ["LIFEBOAT_PQ_V1", chainId, wallet, leaf, deadline, callsHash],
    ),
  );
}

export const pqWalletAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [{ name: "leaf", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "calls", ...callsAbiType[0] }, { name: "witness", type: "bytes" }],
    outputs: [],
  },
  { type: "function", name: "isLeafUsed", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "root", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "verifier", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
