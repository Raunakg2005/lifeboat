import { useEffect, useMemo, useState } from "react";
import { concat, createWalletClient, custom, encodeFunctionData, formatEther, getAddress, isAddress, parseEther, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  GUARD_KIND,
  GUARD_SLOT,
  HANDLER_SLOT,
  cancelRecoveryHash,
  execTransactionData,
  guardDigest,
  guardFactoryAbi,
  installGuardTx,
  quantumGuardAbi,
  safeAbi,
  safeTxHash,
  safeTypedData,
  simpleSafeTx,
  slotAddress,
  sortSignatures,
  type SafeTx,
} from "@lifeboat/core";
import { fromHex, generateKeyPair, sign, toHex, type KeyPair } from "@lifeboat/pq";
import sepoliaDeployments from "../../deployments/sepolia.json";
import { REPO, sepoliaAddr, sepoliaClient, sepoliaTx, short } from "./lib";
import { Pill, Radar, Rubber } from "./ui";
import NameProtect from "./NameProtect";

const CHAIN = 11155111;
const FACTORY = (sepoliaDeployments as { quantumGuardV2?: { factory?: Address } }).quantumGuardV2?.factory;
const TX_SERVICE = "https://api.safe.global/tx-service/sep/api/v1";
const DEFAULT_DELAY = 7 * 24 * 3600;
const KEY_STORE = "lifeboat.pq-guard-key.v1";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any> };
const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;

type StoredKey = { skSeed: Hex; pubSeed: Hex; root: Hex; nextLeaf: number; createdAt: string };
type Guard = { root: Hex; pubSeed: Hex; usedLeaves: bigint; recoveryDelay: bigint; recoveryNonce: bigint; recoveryReadyAt: bigint; recovered: boolean };
type SafeInfo = { address: Address; version: string; owners: Address[]; threshold: number; nonce: bigint; balance: bigint; guard: Address; handler: Address; qg: Guard | null; block: bigint };
type Pending = { tx: SafeTx; hash: Hex; label: string; pq: boolean };

// ---------------------------------------------------------------- the browser PQ key (testnet only)
const loadKey = (): StoredKey | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) ?? "null");
  } catch {
    return null;
  }
};
const saveKey = (k: StoredKey) => localStorage.setItem(KEY_STORE, JSON.stringify(k));
const pairCache = new Map<string, KeyPair>();
const pairOf = (k: StoredKey) => {
  if (!pairCache.has(k.root)) pairCache.set(k.root, generateKeyPair(fromHex(k.skSeed), fromHex(k.pubSeed)));
  return pairCache.get(k.root)!;
};

/**
 * Everything is read at ONE block (at least `atLeast`). Public RPCs are load-balanced: a node that doesn't have that
 * block yet errors, and the fallback moves on, so the Safe and its guard never come from different moments.
 */
async function readSafe(address: Address, atLeast = 0n): Promise<SafeInfo> {
  const c = sepoliaClient;
  const latest = await c.getBlockNumber();
  const block = latest > atLeast ? latest : atLeast;
  const at = { blockNumber: block };
  const [version, owners, threshold, nonce, balance, gw, hw] = await Promise.all([
    c.readContract({ address, abi: safeAbi, functionName: "VERSION", ...at }).catch(() => "?"),
    c.readContract({ address, abi: safeAbi, functionName: "getOwners", ...at }),
    c.readContract({ address, abi: safeAbi, functionName: "getThreshold", ...at }),
    c.readContract({ address, abi: safeAbi, functionName: "nonce", ...at }),
    c.getBalance({ address, ...at }),
    c.getStorageAt({ address, slot: GUARD_SLOT, ...at }),
    c.getStorageAt({ address, slot: HANDLER_SLOT, ...at }),
  ]);
  const guard = slotAddress(gw);
  let qg: Guard | null = null;
  if (BigInt(guard) !== 0n) {
    try {
      const r = (fn: string) => c.readContract({ address: guard, abi: quantumGuardAbi, functionName: fn as any, ...at });
      const [root, pubSeed, usedLeaves] = await Promise.all(["root", "pubSeed", "usedLeaves"].map(r));
      // v1 guards (no lost-key recovery) answer the first three only
      const [recoveryDelay, recoveryNonce, recoveryReadyAt, recovered] = await Promise.all(["recoveryDelay", "recoveryNonce", "recoveryReadyAt", "recovered"].map(r)).catch(() => [0n, 0n, 0n, false]);
      qg = { root, pubSeed, usedLeaves, recoveryDelay, recoveryNonce, recoveryReadyAt, recovered } as Guard;
    } catch {
      qg = null; // some other guard
    }
  }
  return { address, version: version as string, owners: owners as Address[], threshold: Number(threshold), nonce: nonce as bigint, balance, guard, handler: slotAddress(hw), qg, block };
}

export default function ProtectView() {
  const [what, setWhat] = useState<"safe" | "ens">("safe");
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [info, setInfo] = useState<SafeInfo | null>(null);
  const [key, setKey] = useState<StoredKey | null>(loadKey);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState<{ text: string; hash?: Hex }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmations, setConfirmations] = useState<{ owner: Address; signature: Hex }[]>([]);
  const [sendTo, setSendTo] = useState("");
  const [sendEth, setSendEth] = useState("0.0001");
  const hasWallet = !!eth();

  const wallet = useMemo(() => (account && eth() ? createWalletClient({ account, chain: sepolia, transport: custom(eth()!) }) : null), [account]);
  const isOwner = !!(account && info?.owners.some((o) => o.toLowerCase() === account.toLowerCase()));
  const ourKeyOnGuard = !!(key && info?.qg && info.qg.root.toLowerCase() === key.root.toLowerCase());
  const note = (text: string, hash?: Hex) => setLog((l) => [{ text, hash }, ...l].slice(0, 12));

  useEffect(() => {
    type Listen = (ev: string, f: (x: never) => void) => void;
    const e = eth() as (Eip1193 & { on?: Listen; removeListener?: Listen }) | undefined;
    const onAccounts = (a: string[]) => setAccount(a[0] ? getAddress(a[0]) : null);
    const onChain = (c: string) => setChainId(Number(c));
    e?.on?.("accountsChanged", onAccounts);
    e?.on?.("chainChanged", onChain);
    // remove them when the tab closes, so every visit to Protect doesn't add another pair
    return () => {
      e?.removeListener?.("accountsChanged", onAccounts);
      e?.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const guarded = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setErr("");
    try {
      await f();
    } catch (e) {
      setErr(String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message).slice(0, 260));
    } finally {
      setBusy("");
    }
  };

  const connect = () =>
    guarded("Connecting", async () => {
      const [a] = (await eth()!.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(getAddress(a!));
      let c = Number(await eth()!.request({ method: "eth_chainId" }));
      if (c !== CHAIN) {
        await eth()!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
        c = Number(await eth()!.request({ method: "eth_chainId" }));
      }
      setChainId(c);
    });

  const load = (addr = input) =>
    guarded("Reading the Safe", async () => {
      if (!isAddress(addr.trim(), { strict: false })) throw new Error("Enter a Safe address on Sepolia (0x…).");
      setInfo(await readSafe(getAddress(addr.trim())));
      setPending(null);
      setConfirmations([]);
    });
  const refresh = async () => info && setInfo(await readSafe(info.address));
  /**
   * Public RPCs are load-balanced and can answer from a node a block behind. After a transaction, keep reading until
   * the Safe shows it (its block, and the nonce moved on), so the next signature never uses a stale nonce or bitmap.
   */
  const settle = async (minBlock: bigint, minNonce?: bigint) => {
    for (let i = 0; i < 15; i++) {
      try {
        const s = await readSafe(info!.address, minBlock);
        if (minNonce === undefined || s.nonce >= minNonce) return setInfo(s);
      } catch {
        // a node without that block yet: try again
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await refresh();
  };

  const newKey = () =>
    guarded("Generating a WOTS+C key (256 one-time leaves)", async () => {
      await new Promise((r) => setTimeout(r, 30)); // let the label paint
      const rnd = () => crypto.getRandomValues(new Uint8Array(32));
      const pair = generateKeyPair(rnd(), rnd());
      const k: StoredKey = { skSeed: toHex(pair.skSeed) as Hex, pubSeed: toHex(pair.pubSeed) as Hex, root: toHex(pair.root) as Hex, nextLeaf: 0, createdAt: new Date().toISOString() };
      pairCache.set(k.root, pair);
      saveKey(k);
      setKey(k);
    });

  const backup = () => {
    if (!key) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...key, warning: "WOTS+C secret seed: anyone with this file can co-sign. Testnet only." }, null, 2)], { type: "application/json" }));
    a.download = `lifeboat-pq-key-${key.root.slice(2, 10)}.json`;
    a.click();
  };

  /** The next leaf that is unused both here and on-chain, saved BEFORE anything is signed with it. */
  const reserveLeaf = (): number => {
    if (!key || !info?.qg) throw new Error("No post-quantum key for this guard.");
    let leaf = key.nextLeaf;
    while (leaf < 256 && (info.qg.usedLeaves >> BigInt(leaf)) & 1n) leaf++;
    if (leaf >= 256) throw new Error("All 256 leaves are used: rotate the key.");
    const k = { ...key, nextLeaf: leaf + 1 };
    saveKey(k);
    setKey(k);
    return leaf;
  };
  const pqSign = (kind: number, h: Hex) => {
    const leaf = reserveLeaf();
    const d = guardDigest(CHAIN, info!.guard, info!.address, kind, h);
    return { leaf, witness: toHex(sign(pairOf(key!), leaf, fromHex(d)).witness) as Hex };
  };

  const ownerSign = async (tx: SafeTx) => (await wallet!.signTypedData({ account: account!, ...safeTypedData(CHAIN, info!.address, tx) })) as Hex;

  async function execute(tx: SafeTx, ownerSigs: Hex, pq: boolean, label: string) {
    let signatures = ownerSigs;
    if (pq) {
      const { leaf, witness } = pqSign(GUARD_KIND.tx, safeTxHash(CHAIN, info!.address, tx));
      signatures = concat([ownerSigs, witness]);
      note(`post-quantum co-signature with leaf ${leaf}`);
    }
    // explicit gas: an estimate from a lagging node can come out too low for the Safe's inner call
    const hash = await wallet!.sendTransaction({ account: account!, chain: sepolia, to: info!.address, data: execTransactionData(tx, signatures), gas: pq ? 700_000n : 500_000n });
    note(`${label}: sent`, hash);
    const r = await sepoliaClient.waitForTransactionReceipt({ hash });
    note(`${label}: ${r.status === "success" ? "included" : "reverted"} in block ${r.blockNumber}`, hash);
    if (r.status !== "success") throw new Error(`${label} reverted on-chain`);
    await settle(r.blockNumber, tx.nonce + 1n);
  }

  /** One owner: sign and execute here. Several: propose to Safe's transaction service and wait for the others. */
  async function runSafeTx(tx: SafeTx, pq: boolean, label: string) {
    if (!isOwner) throw new Error("Connect a wallet that owns this Safe.");
    const sig = await ownerSign(tx);
    if (info!.threshold === 1) return execute(tx, sig, pq, label);
    const hash = safeTxHash(CHAIN, info!.address, tx);
    const body = {
      to: tx.to,
      value: tx.value.toString(),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: Number(tx.nonce),
      contractTransactionHash: hash,
      sender: account,
      signature: sig,
      origin: "Lifeboat",
    };
    const r = await fetch(`${TX_SERVICE}/safes/${info!.address}/multisig-transactions/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Safe transaction service: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    setPending({ tx, hash, label, pq });
    setConfirmations([{ owner: account!, signature: sig }]);
    note(`${label}: proposed to the Safe's queue. ${info!.threshold - 1} more owner(s) confirm in Safe{Wallet}, then execute here.`);
  }

  const checkPending = () =>
    guarded("Reading confirmations", async () => {
      const r = await fetch(`${TX_SERVICE}/multisig-transactions/${pending!.hash}/`);
      if (!r.ok) throw new Error(`Safe transaction service: HTTP ${r.status}`);
      const j = (await r.json()) as { confirmations: { owner: string; signature: Hex }[] };
      setConfirmations(j.confirmations.map((c) => ({ owner: getAddress(c.owner), signature: c.signature })));
    });

  const executePending = () =>
    guarded("Executing", async () => {
      if (confirmations.length < info!.threshold) throw new Error(`${confirmations.length} of ${info!.threshold} confirmations so far.`);
      await execute(pending!.tx, sortSignatures(confirmations), pending!.pq, pending!.label);
      setPending(null);
      setConfirmations([]);
    });

  // ---------------------------------------------------------------- actions
  const install = () =>
    guarded("Installing Quantum Guard", async () => {
      if (!FACTORY) throw new Error("No QuantumGuardFactory recorded for Sepolia yet.");
      if (!key) throw new Error("Create a post-quantum key first.");
      const args = [info!.address, key.root, key.pubSeed, BigInt(DEFAULT_DELAY)] as const;
      const guard = (await sepoliaClient.readContract({ address: FACTORY, abi: guardFactoryAbi, functionName: "predict", args })) as Address;
      if (!(await sepoliaClient.getCode({ address: guard }))) {
        const hash = await wallet!.sendTransaction({ account: account!, chain: sepolia, to: FACTORY, data: encodeFunctionData({ abi: guardFactoryAbi, functionName: "deploy", args }) });
        note("guard deployed by the factory", hash);
        await sepoliaClient.waitForTransactionReceipt({ hash });
      }
      await runSafeTx(installGuardTx(info!.address, guard, info!.nonce), false, "install: setGuard + setFallbackHandler");
    });

  const sendCoSigned = () =>
    guarded("Co-signing a payment", async () => {
      if (!isAddress(sendTo.trim(), { strict: false })) throw new Error("Enter a recipient address.");
      await runSafeTx(simpleSafeTx(getAddress(sendTo.trim()), parseEther(sendEth || "0"), "0x", info!.nonce), true, `pay ${sendEth} ETH`);
    });

  const ownersOnly = (fn: "startRecovery" | "finishRecovery") =>
    guarded(fn === "startRecovery" ? "Starting a recovery" : "Finishing the recovery", async () => {
      await runSafeTx(simpleSafeTx(info!.guard, 0n, encodeFunctionData({ abi: quantumGuardAbi, functionName: fn }), info!.nonce), false, fn);
    });

  const cancelRecovery = () =>
    guarded("Cancelling the recovery", async () => {
      const { leaf, witness } = pqSign(GUARD_KIND.cancelRecovery, cancelRecoveryHash(info!.qg!.recoveryNonce));
      const hash = await wallet!.sendTransaction({ account: account!, chain: sepolia, to: info!.guard, data: encodeFunctionData({ abi: quantumGuardAbi, functionName: "cancelRecovery", args: [witness] }), gas: 400_000n });
      const r = await sepoliaClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("the veto reverted on-chain");
      note(`recovery #${info!.qg!.recoveryNonce} cancelled with PQ leaf ${leaf}`, hash);
      await settle(r.blockNumber);
    });

  // ---------------------------------------------------------------- view
  const q = info?.qg;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const usedCount = q ? q.usedLeaves.toString(2).split("").filter((b) => b === "1").length : 0;
  return (
    <>
      <div className="protect-switch">
        <span className="label">Protect a</span>
        <div className="seg" role="group" aria-label="What to protect">
          <button aria-pressed={what === "safe"} onClick={() => setWhat("safe")}>
            Safe
          </button>
          <button aria-pressed={what === "ens"} onClick={() => setWhat("ens")}>
            ENS name
          </button>
        </div>
        <span className="note">{what === "safe" ? "a post-quantum co-signer for a Safe" : "a name held by a post-quantum wallet, signed on your hardware key"}</span>
      </div>
      {/* both stay mounted, so switching keeps each flow's state (and the device's serial port) */}
      <div hidden={what !== "ens"}>
        <NameProtect />
      </div>
      <div hidden={what !== "safe"}>
      <section className="section" style={{ marginTop: 26 }}>
        <div className="label">Quantum Guard · Sepolia testnet · nothing here touches mainnet</div>
        <h2>
          Protect a Safe. <span className="o">No funds move.</span>
        </h2>
        <p className="lead">
          Add a post-quantum co-signer to a Safe you own: every transaction then needs the owners <b>and</b> a hash-based signature a quantum computer can't forge, and so do the Safe's off-chain
          signatures (Permit2, CoW orders). Lose the key, and the owners can recover after a {DEFAULT_DELAY / 86400}-day timelock that the key can veto.
        </p>
        <div className="protect-steps">
          <div className="paper-card">
            <div className="label">1 · Wallet</div>
            {!hasWallet ? (
              <p className="note">Install a browser wallet (MetaMask, Rabby…) to protect a Safe. Reading a Safe works without one.</p>
            ) : account ? (
              <p className="mono">
                {short(account, 5)} · {chainId === CHAIN ? "Sepolia" : <span className="faint">wrong network</span>}
              </p>
            ) : (
              <button className="cta" onClick={connect} disabled={!!busy}>
                Connect wallet
              </button>
            )}
          </div>
          <div className="paper-card">
            <div className="label">2 · Post-quantum key</div>
            {key ? (
              <>
                <p className="mono" style={{ margin: "4px 0" }}>
                  root {short(key.root, 6)} · next leaf {key.nextLeaf}
                </p>
                <button className="link-btn" onClick={backup}>
                  download a backup
                </button>
              </>
            ) : (
              <button className="cta ghost" onClick={newKey} disabled={!!busy}>
                Create a key
              </button>
            )}
            <p className="note" style={{ marginBottom: 0 }}>
              Kept in this browser, testnet only. In production it lives on the hardware signer.
            </p>
          </div>
          <div className="paper-card">
            <div className="label">3 · Safe on Sepolia</div>
            <form
              className="passenger"
              style={{ boxShadow: "none" }}
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
            >
              <input aria-label="Safe address on Sepolia" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… Safe address" spellCheck={false} autoComplete="off" />
              <button type="submit" disabled={!!busy}>
                Load
              </button>
            </form>
          </div>
        </div>
        {busy && (
          <div className="board loading" style={{ marginTop: 14 }}>
            <Radar />
            <div className="stencil" style={{ fontSize: 26 }}>
              {busy}…
            </div>
          </div>
        )}
        {err && <p className="error-box">{err}</p>}
      </section>

      {info && (
        <section className="section grid cols-2">
          <div className="board">
            <div className="board-head">
              <h3>Safe {short(info.address)}</h3>
              <span className="label">
                v{info.version} · block {info.block.toString()}
              </span>
            </div>
            <div className="board-body">
              <div className="qrows">
                <div>
                  <span className="label">Owners</span>
                  <b>
                    {info.threshold} of {info.owners.length}
                    {isOwner ? " · you are an owner" : ""}
                  </b>
                </div>
                <div>
                  <span className="label">Balance</span>
                  <b className="mono">{Number(formatEther(info.balance)).toFixed(4)} ETH</b>
                </div>
                <div>
                  <span className="label">Guard</span>
                  <b>{q ? <Pill status="pq">Quantum Guard</Pill> : BigInt(info.guard) ? <Pill status="contract">other guard</Pill> : <Pill status="exposed">none</Pill>}</b>
                </div>
                <div>
                  <span className="label">Signature handler</span>
                  <b>{info.handler.toLowerCase() === info.guard.toLowerCase() && q ? <Pill status="pq">Quantum Guard</Pill> : <Pill status="contract">{short(info.handler)}</Pill>}</b>
                </div>
                {q && (
                  <>
                    <div>
                      <span className="label">One-time leaves used</span>
                      <b className="mono">{usedCount} of 256</b>
                    </div>
                    <div>
                      <span className="label">Recovery</span>
                      <b>
                        {q.recovered
                          ? "completed: owners act alone"
                          : q.recoveryReadyAt > 0n
                            ? q.recoveryReadyAt > now
                              ? `pending, ready in ${Math.ceil(Number(q.recoveryReadyAt - now) / 3600)} h`
                              : "pending, ready to finish"
                            : "none"}
                      </b>
                    </div>
                    <div>
                      <span className="label">This browser's key</span>
                      <b>{ourKeyOnGuard ? <Pill status="pq">matches the guard</Pill> : <Pill status="contract">not this guard's key</Pill>}</b>
                    </div>
                  </>
                )}
              </div>
              <p className="note" style={{ marginBottom: 0 }}>
                <a href={sepoliaAddr(info.address)} target="_blank" rel="noreferrer">
                  Safe on Etherscan
                </a>
                {q && (
                  <>
                    {" · "}
                    <a href={sepoliaAddr(info.guard)} target="_blank" rel="noreferrer">
                      guard
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="board">
            <div className="board-head">
              <h3>Actions</h3>
              <span className="label">{isOwner ? "signed by your wallet" : "connect an owner's wallet"}</span>
            </div>
            <div className="board-body protect-actions">
              {!q ? (
                <>
                  <p style={{ marginTop: 0 }}>One Safe transaction installs the guard and makes it the signature handler. Every later transaction needs the post-quantum co-signature.</p>
                  <button className="cta" disabled={!!busy || !isOwner || !key || !FACTORY} onClick={install}>
                    Install Quantum Guard
                  </button>
                </>
              ) : (
                <>
                  <div className="label">A co-signed payment</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input className="field" placeholder="0x… recipient" value={sendTo} onChange={(e) => setSendTo(e.target.value)} spellCheck={false} />
                    <input className="field" style={{ width: 110 }} value={sendEth} onChange={(e) => setSendEth(e.target.value)} aria-label="ETH amount" />
                    <button className="cta" disabled={!!busy || !isOwner || !ourKeyOnGuard || q.recovered} onClick={sendCoSigned}>
                      Co-sign &amp; send
                    </button>
                  </div>
                  <div className="label" style={{ marginTop: 16 }}>
                    Lost-key recovery
                  </div>
                  {q.recoveryDelay === 0n ? (
                    <p className="note">This guard is a first version, without lost-key recovery. Installing a new one (with the owners and the PQ key) adds it.</p>
                  ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="cta ghost" disabled={!!busy || !isOwner || q.recovered || q.recoveryReadyAt > 0n} onClick={() => ownersOnly("startRecovery")}>
                      Start (owners)
                    </button>
                    <button className="cta ghost" disabled={!!busy || !isOwner || q.recoveryReadyAt === 0n || q.recoveryReadyAt > now} onClick={() => ownersOnly("finishRecovery")}>
                      Finish (owners)
                    </button>
                    <button className="cta" disabled={!!busy || !account || !ourKeyOnGuard || q.recoveryReadyAt === 0n} onClick={cancelRecovery}>
                      Veto (PQ key)
                    </button>
                  </div>
                  )}
                </>
              )}
              {pending && (
                <div className="paper-card" style={{ marginTop: 14 }}>
                  <div className="label">Waiting for owners</div>
                  <p style={{ margin: "4px 0" }}>
                    {pending.label}: {confirmations.length} of {info.threshold} confirmations
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="cta ghost" disabled={!!busy} onClick={checkPending}>
                      Refresh
                    </button>
                    <button className="cta" disabled={!!busy || confirmations.length < info.threshold} onClick={executePending}>
                      Execute{pending.pq ? " with PQ co-signature" : ""}
                    </button>
                  </div>
                </div>
              )}
              {log.length > 0 && (
                <ul className="protect-log">
                  {log.map((l, i) => (
                    <li key={i}>
                      {l.text}
                      {l.hash && (
                        <>
                          {" "}
                          <a className="mono" href={sepoliaTx(l.hash)} target="_blank" rel="noreferrer">
                            {short(l.hash, 6)} ↗
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="seal good">
          <Rubber good>Testnet</Rubber>
          <div>
            <div className="big">Built for Sepolia first</div>
            <div className="muted">
              The guard and its factory are on Sepolia, unaudited. Mainnet comes after an external audit, with the key on a hardware signer.{" "}
              <a href={`${REPO}/blob/main/docs/quantum-guard.md`} target="_blank" rel="noreferrer">
                How it works
              </a>
            </div>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
