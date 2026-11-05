// Hidden exposure: a Safe signer that never sent a transaction still publishes its public key every time it
// signs one of the Safe's transactions. The usual "has this address sent a transaction?" check misses it.
//
// For one Safe: read owners and threshold, check each owner's nonce on several chains, then recover the
// signer of every signature in the Safe's executed transactions (ExecutionSuccess logs carry the safeTxHash).
// A recovered signer's public key is on-chain, whatever its nonce says.
import {
  decodeFunctionData,
  getAddress,
  hashMessage,
  parseAbi,
  recoverAddress,
  recoverPublicKey,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { CHAINS, type ChainInfo } from "./exposure.js";
import { createPublicClient, http } from "viem";

const SAFE_ABI = parseAbi([
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function VERSION() view returns (string)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);
// ExecutionSuccess(bytes32 txHash, uint256 payment): txHash is in the data up to Safe 1.3, and indexed (topics[1]) from 1.4
const EXECUTION_SUCCESS_TOPIC = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";

export type SignerHow = "nonce" | "signature" | "both" | "hidden" | "contract";

export interface SafeSigner {
  address: Address;
  isContract: boolean;
  nonces: Record<string, number>; // chain name -> nonce
  byNonce: boolean;
  bySignature: { txHash: Hex; safeTxHash: Hex; publicKey: Hex } | null;
  how: SignerHow;
  /** set when the owner is itself a Safe (scanned one level down) */
  nested?: { label: string; threshold: number; owners: number; exposedByNonce: number; exposedTotal: number; takeableByNonce: boolean; takeableWithSignatures: boolean } | null;
}

export interface SafeScan {
  safe: Address;
  label: string;
  version: string;
  threshold: number;
  owners: SafeSigner[];
  block: bigint;
  executionsSeen: number;
  executionsDecoded: number;
  exposedByNonce: number;
  exposedTotal: number;
  takeableByNonce: boolean;
  takeableWithSignatures: boolean;
}

/** Splits Safe `signatures` bytes into 65-byte entries and recovers EOA signers (v 27/28 and eth_sign v > 30). */
export async function recoverSafeSigners(safeTxHash: Hex, signatures: Hex): Promise<{ signer: Address; publicKey: Hex | null; kind: "ecdsa" | "eth_sign" | "contract" | "approved" }[]> {
  const raw = signatures.slice(2);
  const out: { signer: Address; publicKey: Hex | null; kind: "ecdsa" | "eth_sign" | "contract" | "approved" }[] = [];
  for (let i = 0; i + 130 <= raw.length; i += 130) {
    const r = `0x${raw.slice(i, i + 64)}` as Hex;
    const s = `0x${raw.slice(i + 64, i + 128)}` as Hex;
    const v = parseInt(raw.slice(i + 128, i + 130), 16);
    if (v === 0) out.push({ signer: getAddress(`0x${r.slice(26)}`), publicKey: null, kind: "contract" });
    else if (v === 1) out.push({ signer: getAddress(`0x${r.slice(26)}`), publicKey: null, kind: "approved" });
    else {
      const ethSign = v > 30;
      const hash = ethSign ? hashMessage({ raw: safeTxHash }) : safeTxHash;
      const sig = `0x${raw.slice(i, i + 128)}${(ethSign ? v - 4 : v).toString(16).padStart(2, "0")}` as Hex;
      try {
        const [signer, publicKey] = await Promise.all([recoverAddress({ hash, signature: sig }), recoverPublicKey({ hash, signature: sig })]);
        out.push({ signer, publicKey, kind: ethSign ? "eth_sign" : "ecdsa" });
      } catch {}
    }
    void s;
  }
  return out;
}

export async function scanSafe(
  client: PublicClient,
  logs: PublicClient,
  safe: Address,
  opts: { label?: string; maxExecutions?: number; chains?: ChainInfo[]; onStep?: (s: string) => void; depth?: number } = {},
): Promise<SafeScan> {
  const step = opts.onStep ?? (() => {});
  const block = await client.getBlockNumber();
  const [threshold, owners, version] = await Promise.all([
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getThreshold", blockNumber: block }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners", blockNumber: block }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: "VERSION", blockNumber: block }).catch(() => "?"),
  ]);
  step(`${owners.length} owners, threshold ${threshold}: checking nonces on ${(opts.chains ?? CHAINS).length} chains`);

  const chains = (opts.chains ?? CHAINS).filter((c) => c.id !== 11155111);
  const clients = chains.map((c) => ({ c, pc: createPublicClient({ transport: http(c.rpc, { timeout: 15_000, retryCount: 2 }) }) }));
  const signers: SafeSigner[] = await Promise.all(
    owners.map(async (o) => {
      const code = await client.getCode({ address: o });
      const nonces: Record<string, number> = {};
      await Promise.all(clients.map(async ({ c, pc }) => (nonces[c.name] = await pc.getTransactionCount({ address: o }).catch(() => 0))));
      const isContract = !!code && code !== "0x";
      return { address: o, isContract, nonces, byNonce: !isContract && Object.values(nonces).some((n) => n > 0), bySignature: null, how: "hidden" as SignerHow };
    }),
  );

  step("Reading the Safe's executed transactions");
  const rawLogs = (await logs.request({ method: "eth_getLogs", params: [{ address: safe, topics: [EXECUTION_SUCCESS_TOPIC], fromBlock: "0x0", toBlock: `0x${block.toString(16)}` }] } as any)) as { topics: Hex[]; data: Hex; transactionHash: Hex }[];
  const evs = rawLogs.map((l) => ({ transactionHash: l.transactionHash, safeTxHash: (l.topics.length > 1 ? l.topics[1] : (`0x${l.data.slice(2, 66)}` as Hex)) as Hex }));
  const recent = evs.slice(-(opts.maxExecutions ?? 60)).reverse();
  let decoded = 0;
  step(`Recovering signers from ${recent.length} of ${evs.length} executions`);
  const byAddr = new Map(signers.map((s) => [s.address.toLowerCase(), s]));
  await Promise.all(
    recent.map(async (ev) => {
      const tx = await client.getTransaction({ hash: ev.transactionHash }).catch(() => null);
      if (!tx || tx.to?.toLowerCase() !== safe.toLowerCase() || !tx.input.startsWith("0x6a761202")) return; // via another contract: skipped (lower bound)
      let sigs: Hex;
      try {
        sigs = (decodeFunctionData({ abi: SAFE_ABI, data: tx.input }).args as readonly unknown[])[9] as Hex;
      } catch {
        return;
      }
      decoded++;
      for (const r of await recoverSafeSigners(ev.safeTxHash, sigs)) {
        const s = byAddr.get(r.signer.toLowerCase());
        if (s && r.publicKey && !s.bySignature) s.bySignature = { txHash: ev.transactionHash, safeTxHash: ev.safeTxHash, publicKey: r.publicKey };
      }
    }),
  );
  for (const s of signers) s.how = s.isContract ? "contract" : s.byNonce && s.bySignature ? "both" : s.byNonce ? "nonce" : s.bySignature ? "signature" : "hidden";
  // nested Safes: an owner that is itself a takeable Safe counts as taken over
  if ((opts.depth ?? 1) > 0)
    await Promise.all(
      signers
        .filter((s) => s.isContract)
        .map(async (s) => {
          try {
            const n = await scanSafe(client, logs, s.address, { ...opts, label: `nested Safe ${s.address.slice(0, 8)}`, depth: (opts.depth ?? 1) - 1, onStep: undefined });
            s.nested = { label: n.label, threshold: n.threshold, owners: n.owners.length, exposedByNonce: n.exposedByNonce, exposedTotal: n.exposedTotal, takeableByNonce: n.takeableByNonce, takeableWithSignatures: n.takeableWithSignatures };
          } catch {
            s.nested = null; // not a Safe
          }
        }),
    );
  const exposedByNonce = signers.filter((s) => s.byNonce || s.nested?.takeableByNonce).length;
  const exposedTotal = signers.filter((s) => s.byNonce || s.bySignature || s.nested?.takeableWithSignatures).length;
  const t = Number(threshold);
  return {
    safe,
    label: opts.label ?? safe,
    version,
    threshold: t,
    owners: signers,
    block,
    executionsSeen: evs.length,
    executionsDecoded: decoded,
    exposedByNonce,
    exposedTotal,
    takeableByNonce: exposedByNonce >= t,
    takeableWithSignatures: exposedTotal >= t,
  };
}

/** Public infrastructure only (security councils, protocol multisigs). Individuals are never listed. */
export const COUNCILS: { label: string; safe: Address }[] = [
  { label: "Arbitrum Security Council (L1)", safe: "0xF06E95eF589D9c38af242a8AAee8375f14023F85" },
  { label: "Optimism Security Council", safe: "0xc2819DC788505Aac350142A7A707BF9D03E3Bd03" },
  { label: "Base multisig", safe: "0x7bB41C3008B3f03FE483B28b8DB90e19Cf07595c" },
  { label: "Base multisig 2", safe: "0x9855054731540A48b28990B63DcF4f33d8AE46A1" },
];

export const TENDERLY_MAINNET = "https://mainnet.gateway.tenderly.co";
