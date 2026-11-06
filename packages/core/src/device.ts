// Requests for the ESP32 signer's clear signing (firmware/esp32/lifeboat_signer/clear.h). The host never sends a
// bare hash: each request carries its own fields, and the device rebuilds the hash from them and shows them in
// words. These builders compute the same hash here, so the host can grind the counter and check the device's
// WOTS|HASH line before the person is asked to press the button. Browser-safe.
import { bytesToHex, encodeAbiParameters, keccak256, stringToBytes, toHex, type Address, type Hex } from "viem";
import { GUARD_KIND, guardDigest, safeTxHash, type SafeTx } from "./guard.js";

export type DeviceRequest = {
  kind: "MSG" | "PQW" | "SAFE" | "FRAME";
  /** what the WOTS+C key signs; the device computes the same value and reports it as WOTS|HASH */
  sigHash: Hex;
  /** the serial line, once the counter is ground */
  line: (counter: number) => string;
};

export const MESSAGE_PREFIX = "\x19Lifeboat Signed Message:\n";
const noPrefix = (h: Hex) => h.slice(2);

/** A plain-text message (printable ASCII, up to 512 characters). */
export function messageRequest(text: string): DeviceRequest {
  if (!/^[\x20-\x7e]{1,512}$/.test(text)) throw new Error("the device signs printable ASCII text only (1-512 characters)");
  const body = stringToBytes(text);
  const sigHash = keccak256(stringToBytes(`${MESSAGE_PREFIX}${body.length}${text}`));
  return { kind: "MSG", sigHash, line: (c) => `WOTS|MSG|${c}|${noPrefix(bytesToHex(body))}` };
}

export type WalletCall = { target: Address; value: bigint; data: Hex };
const callsType = [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }] as const;

/** A LifeboatPQWallet.execute: same digest as the contract's digest(leaf, deadline, calls). */
export function pqWalletRequest(p: { chainId: number | bigint; wallet: Address; leaf: number; deadline: bigint; calls: WalletCall[] }): DeviceRequest {
  if (!p.calls.length || p.calls.length > 4) throw new Error("the device shows 1 to 4 calls per request");
  const encoded = encodeAbiParameters(callsType, [p.calls]);
  const sigHash = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      ["LIFEBOAT_PQ_V1", BigInt(p.chainId), p.wallet, BigInt(p.leaf), p.deadline, keccak256(encoded)],
    ),
  );
  return { kind: "PQW", sigHash, line: (c) => `WOTS|PQW|${c}|${BigInt(p.chainId)}|${p.wallet}|${p.leaf}|${p.deadline}|${noPrefix(encoded)}` };
}

/** A Quantum Guard co-signature for one Safe transaction. */
export function safeRequest(p: { chainId: number; guard: Address; safe: Address; tx: SafeTx }): DeviceRequest {
  const t = p.tx;
  const sigHash = guardDigest(p.chainId, p.guard, p.safe, GUARD_KIND.tx, safeTxHash(p.chainId, p.safe, t));
  const fields = [p.chainId, p.guard, p.safe, t.to, toHex(t.value), t.data, t.operation, t.safeTxGas, t.baseGas, toHex(t.gasPrice), t.gasToken, t.refundReceiver, t.nonce];
  return { kind: "SAFE", sigHash, line: (c) => `WOTS|SAFE|${c}|${fields.map(String).join("|")}` };
}

/** An EIP-8141 frame transaction: `unsigned` is its encoding with the signature bytes elided (what sigHash hashes). */
export function frameRequest(unsigned: Hex): DeviceRequest {
  return { kind: "FRAME", sigHash: keccak256(unsigned), line: (c) => `WOTS|FRAME|${c}|${noPrefix(unsigned)}` };
}
