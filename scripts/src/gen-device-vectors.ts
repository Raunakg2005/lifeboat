// Writes firmware/esp32/test/requests.json: clear-signing requests built by the TypeScript host code
// (packages/core/src/device.ts), each with the hash the contracts / node expect and what the screen must show.
// tools/firmware-check.mjs runs the firmware's own parser (clear.h) on every line and compares.
// Usage: pnpm --filter @lifeboat/scripts gen-device-vectors
import { mkdirSync, writeFileSync } from "node:fs";
import { concat, encodeFunctionData, keccak256, numberToHex, pad, parseAbi, parseEther, parseGwei, type Address, type Hex } from "viem";
import { encodeTx, frame, newTx, sigHash, type FrameTx } from "@forshtat/hegota-support/tx";
import { dnsEncode, frameRequest, installGuardTx, messageRequest, pqWalletRequest, resolverAbi, safeRequest, simpleSafeTx } from "@lifeboat/core";
import { repoPath } from "./lib/env.js";
import { profile } from "./lib/devnet.js";
import { walletDigest } from "./lib/pqwallet.js";

// fixed, made-up addresses (test vectors only)
const WALLET: Address = "0x2e58b0f2336dfe76b8bbab1bfd927e354cbc997f";
const RESOLVER: Address = "0x00000000000000000000000000000000000ce501";
const TO: Address = "0xbac277e47dd7b95c04bb3517b76c1dd9151a054a";
const TOKEN: Address = "0x0000000000000000000000000000000000000c0c";
const SAFE: Address = "0x14b3bee066ba36e01ea04f43ea9b5e19b8219526";
const GUARD: Address = "0xd7a6403a4bbc19db6dc022ee8200c43c264dd502";
const SENDER: Address = "0x1c3ff4e170967ee70e097b7364890732ca7d00cc";
const DEADLINE = 1794000000n; // 2026-11-06 21:20 UTC

type Case = { name: string; deviceLeaf: number; line: string; sigHash?: Hex; error?: string; show?: string[] };
const cases: Case[] = [];
const ok = (name: string, deviceLeaf: number, req: { sigHash: Hex; line: (c: number) => string }, show: string[], expect?: Hex) => {
  if (expect && expect !== req.sigHash) throw new Error(`${name}: host hash ${req.sigHash} != reference ${expect}`);
  cases.push({ name, deviceLeaf, line: req.line(0), sigHash: req.sigHash, show });
};
const bad = (name: string, deviceLeaf: number, line: string, error: string) => cases.push({ name, deviceLeaf, line, error });

// 1. a message
ok("message", 2, messageRequest("Lifeboat test 2026-11-06T12:00:00Z"), ["MESSAGE", "Lifeboat test 2026-11-06T12:00:00Z"]);

// 2. ENS: the PQ wallet sets a text record (ENSv2 setText(bytes name, string key, string value))
const setText = encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsEncode("lifeboatpq.eth"), "pq.checked", "2026-11-06T12:00:00Z signed by the PQ key"] });
const ensCalls = [{ target: RESOLVER, value: 0n, data: setText }];
ok("ens set text", 5, pqWalletRequest({ chainId: 11155111, wallet: WALLET, leaf: 5, deadline: DEADLINE, calls: ensCalls }),
  ["PQ WALLET", "Sepolia testnet", "setText", "name lifeboatpq.eth", "key pq.checked", "= 2026-11-06T12:00:00Z signed by the PQ key", "valid to 11-06 21:20Z"],
  walletDigest(11155111n, WALLET, 5n, DEADLINE, ensCalls));

// 3. two calls: an ETH payment and a token transfer
const erc20 = parseAbi(["function transfer(address to, uint256 amount)"]);
const two = [
  { target: TO, value: parseEther("0.01"), data: "0x" as Hex },
  { target: TOKEN, value: 0n, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [TO, 2500000n] }) },
];
ok("payment + token", 6, pqWalletRequest({ chainId: 11155111, wallet: WALLET, leaf: 6, deadline: DEADLINE, calls: two }),
  ["-- call 1 of 2 --", "send 0.01 ETH", "0xbac277e47dd7b95c04b", "b3517b76c1dd9151a054a", "-- call 2 of 2 --", "transfer", "amount 2500000 units"],
  walletDigest(11155111n, WALLET, 6n, DEADLINE, two));

// 4. a Safe payment co-signed for the Quantum Guard
ok("safe payment", 7, safeRequest({ chainId: 11155111, guard: GUARD, safe: SAFE, tx: simpleSafeTx(TO, parseEther("0.0001"), "0x", 2n) }),
  ["SAFE TX", "Safe 0x14b3..9526", "nonce 2", "send 0.0001 ETH", "guard 0xd7a6..d502"]);

// 5. the guard install: a DELEGATECALL into MultiSendCallOnly (setGuard + setFallbackHandler)
ok("safe install (delegatecall batch)", 7, safeRequest({ chainId: 11155111, guard: GUARD, safe: SAFE, tx: installGuardTx(SAFE, GUARD, 0n) }),
  ["! DELEGATECALL", "multiSend", "1 setGuard", "2 setFallbackHandler"]);

// 6. an EIP-8141 frame transaction like hw-frame's (VERIFY + SENDER: leaf ‖ to ‖ value)
const tx: FrameTx = newTx({
  chainId: 1337n,
  sender: SENDER,
  nonceSeq: 3n,
  frames: [
    frame(profile, "VERIFY", { execution: 60_000n, scope: "EXECUTION_AND_PAYMENT", data: "0x03" }),
    frame(profile, "SENDER", { execution: 80_000n, state: 200_000n, data: concat([pad(numberToHex(2), { size: 32 }), pad(TO, { size: 32 }), pad(numberToHex(parseEther("0.001")), { size: 32 })]) }),
  ],
  signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0x" }],
  fees: { maxFeePerGas: parseGwei("3.5"), maxPriorityFeePerGas: parseGwei("1") },
});
const unsigned = (t: FrameTx): Hex => encodeTx(profile, { ...t, signatures: t.signatures.map((s) => (s.msg === "0x" ? { ...s, signature: "0x" as Hex } : s)) });
ok("frame tx", 2, frameRequest(unsigned(tx)), ["FRAME TX", "EIP-8141 devnet 1337", "from 0x1c3f..00cc", "nonce 3", "2 SENDER (your act)", "send 0.001 ETH", "max fee 3.5 gwei/gas"], sigHash(profile, tx));

// refusals
const r = pqWalletRequest({ chainId: 11155111, wallet: WALLET, leaf: 5, deadline: DEADLINE, calls: ensCalls });
bad("PQ wallet request for another leaf", 9, r.line(0), "leaf-mismatch");
const parts = r.line(0).split("|");
parts[7] = parts[7]!.slice(0, 63) + "4" + parts[7]!.slice(64); // first offset word: 0x20 -> 0x24 (non-canonical)
bad("non-canonical calls", 5, parts.join("|"), "calls-not-canonical");
const signedTx: FrameTx = { ...tx, signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0xdeadbeef" }] };
bad("frame tx with signature bytes left in", 2, `WOTS|FRAME|0|${encodeTx(profile, signedTx).slice(2)}`, "signature-not-elided");
bad("message with a hidden control character", 2, `WOTS|MSG|0|${Buffer.from("pay me\nall").toString("hex")}`, "msg-not-plain-text");
bad("a request for Ethereum mainnet (testnet-only signer)", 5, pqWalletRequest({ chainId: 1, wallet: WALLET, leaf: 5, deadline: DEADLINE, calls: ensCalls }).line(0), "chain-not-allowed");
bad("a bare hash", 2, `WOTS|SIGN|${keccak256("0x01").slice(2)}|0|label`, "blind-signing-off");

mkdirSync(repoPath("firmware", "esp32", "test"), { recursive: true });
writeFileSync(repoPath("firmware", "esp32", "test", "requests.json"), JSON.stringify({ note: "generated by scripts/src/gen-device-vectors.ts; made-up addresses", cases }, null, 2) + "\n");
console.log(`wrote firmware/esp32/test/requests.json (${cases.length} cases)`);
