import { describe, expect, it } from "vitest";
import { concat, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverSafeSigners } from "../src/safe-scan.js";

// A Safe signature entry is r ‖ s ‖ v (65 bytes). v = 27/28: plain ECDSA over the safeTxHash.
// v = 31/32: eth_sign over the safeTxHash (EIP-191), v − 4. v = 0: contract signature, v = 1: approved hash.
const safeTxHash = keccak256(toHex("lifeboat test safe tx"));

describe("recoverSafeSigners", () => {
  it("recovers the signer and the public key from an ECDSA entry (v = 27/28)", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const sig = await acct.sign({ hash: safeTxHash });
    const [r] = await recoverSafeSigners(safeTxHash, sig);
    expect(r!.kind).toBe("ecdsa");
    expect(r!.signer).toBe(acct.address);
    expect(r!.publicKey).toBe(acct.publicKey);
  });

  it("recovers from an eth_sign entry (v + 4)", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const sig = await acct.signMessage({ message: { raw: safeTxHash } });
    const v = parseInt(sig.slice(-2), 16) + 4;
    const safeEntry = `${sig.slice(0, -2)}${v.toString(16)}` as Hex;
    const [r] = await recoverSafeSigners(safeTxHash, safeEntry);
    expect(r!.kind).toBe("eth_sign");
    expect(r!.signer).toBe(acct.address);
  });

  it("reads several entries and labels contract / approved-hash entries without recovering a key", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const b = privateKeyToAccount(generatePrivateKey());
    const contract = "0x000000000000000000000000c0ffee0000000000000000000000000000000000" as Hex;
    const contractEntry = concat([contract, toHex(0n, { size: 32 }), "0x00"]);
    const approvedEntry = concat([`0x000000000000000000000000${b.address.slice(2)}` as Hex, toHex(0n, { size: 32 }), "0x01"]);
    const all = concat([await a.sign({ hash: safeTxHash }), contractEntry, approvedEntry]);
    const out = await recoverSafeSigners(safeTxHash, all);
    expect(out.map((o) => o.kind)).toEqual(["ecdsa", "contract", "approved"]);
    expect(out[0]!.signer).toBe(a.address);
    expect(out[1]!.publicKey).toBeNull();
    expect(out[2]!.signer).toBe(b.address);
  });
});
