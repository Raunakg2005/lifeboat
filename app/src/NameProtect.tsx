// Protect an ENSv2 name with the hardware key: the name goes to a post-quantum wallet whose key exists only on the
// ESP32, and every later record change is shown on the device's screen and signed there after a button press.
// The connected wallet sends the transactions (it owns the name until the handover, then only relays and pays gas).
// Nothing is saved: the device's public tree and every signature stay in memory.
import { useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, decodeErrorResult, getAddress, isAddress, parseAbi, type Abi, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import {
  ENS,
  deployPqWalletTx,
  deployResolverTx,
  executeData,
  factoryAbi,
  handoverPlan,
  helmCheck,
  pqWalletAbi,
  pqWalletAddress,
  pqWalletRequest,
  registryAbi,
  removeOperatorData,
  resolverAbi,
  resolverInitData,
  resolverSalt,
  revokeRolesData,
  setAddressCalls,
  setResolverData,
  setTextCalls,
  transferNameData,
  type HandoverStep,
  type HelmReport,
  type WalletCall,
} from "@lifeboat/core";
import { SEPOLIA_PQ_WALLETS, mainnetClient, onWalletEvents, sepoliaAddr, sepoliaClient, sepoliaLogs, sepoliaTx, short, walletProvider } from "./lib";
import { LuggageTag, Pill, Radar, Steps } from "./ui";
import { DeviceError, SerialDevice, openErrorText, serialSupported, type DeviceInfo } from "./serialDevice";

const CHAIN = 11155111;
const ZERO = "0x0000000000000000000000000000000000000000";
const HELM = "Helm check";
const HELM_STEPS = ["Finding the registry that holds the name", "Rebuilding every role list from the logs (5 paths in parallel)", "Classifying every key and proving the lists complete"];
const PATH_TITLE: Record<number, string> = { 1: "Owner", 2: "Delegates", 3: "Operators", 4: "Resolver crew", 5: "Port authority" };
/** Gas floors per step: the limit is the larger of this and the estimate × 1.3. */
const GAS_FLOOR: Record<HandoverStep["kind"], bigint> = { resolver: 900_000n, setResolver: 200_000n, revoke: 200_000n, operator: 120_000n, transfer: 300_000n };
const EXECUTE_GAS = 1_500_000n;
const ASK_TEXT = "The ESP32 shows the change: press BOOT for each page, then BOOT to sign.";
const PROOF_LABEL = "pq.checked proof";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (ev: string, f: (x: never) => void) => void; removeListener?: (ev: string, f: (x: never) => void) => void };
const eth = () => walletProvider<Eip1193>(); // EIP-6963 first: see lib.ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const popcount = (x: bigint) => x.toString(2).split("").filter((b) => b === "1").length;

type WalletState = { deployed: boolean; used: number; nextUsed: boolean };
type StepStatus = "todo" | "now" | "done" | "skip" | "fail";
type RunStep = HandoverStep & { status: StepStatus; hash?: Hex; note?: string };
type LogLine = { text: string; hash?: Hex };

// ---------------------------------------------------------------- reverts, in words
const WALLET_ERRORS = parseAbi([
  "error LeafOutOfRange(uint256 leaf)",
  "error LeafUsed(uint256 leaf)",
  "error WitnessLeafMismatch(uint256 leaf, uint256 witnessLeaf)",
  "error Expired(uint256 deadline)",
  "error BadSignature()",
  "error CallFailed(uint256 index, bytes reason)",
  "error OnlySelf()",
]);
const ERR_ABI = [...(registryAbi as Abi), ...(factoryAbi as Abi), ...(resolverAbi as Abi), ...WALLET_ERRORS] as Abi;
const PLAIN: Record<string, string> = {
  TransferUnsafeWithMultipleAssignees: "ENSv2 refuses the transfer while another account still holds a role on the name",
  LeafUsed: "that leaf is already used on chain",
  Expired: "the signature's deadline passed",
  BadSignature: "the post-quantum wallet didn't accept the signature",
  WitnessLeafMismatch: "the signature names another leaf",
};
const message = (e: unknown) => String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
function revertData(e: unknown): Hex | undefined {
  let x = e as { data?: unknown; cause?: unknown } | undefined;
  for (let i = 0; x && i < 10; i++) {
    if (typeof x.data === "string" && x.data.startsWith("0x") && x.data.length >= 10) return x.data as Hex;
    const inner = (x.data as { data?: unknown } | undefined)?.data;
    if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) return inner as Hex;
    x = x.cause as typeof x;
  }
  return undefined;
}
function decodeRevert(data: Hex): string {
  try {
    const d = decodeErrorResult({ abi: ERR_ABI, data });
    if (d.errorName === "CallFailed") {
      const inner = (d.args as readonly unknown[] | undefined)?.[1] as Hex | undefined;
      return `the call inside failed${inner && inner.length >= 10 ? `: ${decodeRevert(inner)}` : ""}`;
    }
    const args = (d.args as readonly unknown[] | undefined) ?? [];
    return PLAIN[d.errorName] ?? `${d.errorName}(${args.map(String).join(", ")})`;
  } catch {
    return `revert ${data.slice(0, 10)}`;
  }
}
const isRevert = (e: unknown) => !!revertData(e) || /revert/i.test(message(e));
const revertText = (e: unknown) => {
  const d = revertData(e);
  return d ? decodeRevert(d) : message(e).slice(0, 200);
};

// ---------------------------------------------------------------- reads that never come from a node behind our last tx
/** Runs `f` at a block that is at least `atLeast`: a load-balanced node without that block errors, and the read is retried. */
async function readAt<T>(f: (blockNumber: bigint) => Promise<T>, atLeast = 0n): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 12; i++) {
    try {
      const latest = await sepoliaClient.getBlockNumber();
      return await f(latest > atLeast ? latest : atLeast);
    } catch (e) {
      if (isRevert(e)) throw e;
      last = e;
      await sleep(2000);
    }
  }
  throw last;
}

/** eth_estimateGas as of `atLeast`. A revert stops here, before anything is sent. */
async function estimate(from: Address, to: Address, data: Hex, atLeast = 0n): Promise<bigint> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      if (atLeast === 0n) return await sepoliaClient.estimateGas({ account: from, to, data });
      const latest = await sepoliaClient.getBlockNumber();
      return await sepoliaClient.estimateGas({ account: from, to, data, blockNumber: latest > atLeast ? latest : atLeast });
    } catch (e) {
      if (/insufficient funds/i.test(message(e))) throw new Error("The connected wallet needs some Sepolia ETH for gas.");
      if (isRevert(e)) throw new Error(`It would revert: ${revertText(e)}. Nothing was sent.`);
      last = e;
      await sleep(2000);
    }
  }
  throw last;
}

async function readWalletState(pq: Address, next: number, atLeast = 0n): Promise<WalletState> {
  return readAt(async (blockNumber) => {
    const code = await sepoliaClient.getCode({ address: pq, blockNumber });
    if (!code || code === "0x") return { deployed: false, used: 0, nextUsed: false };
    const [used, nextUsed] = await Promise.all([
      sepoliaClient.readContract({ address: pq, abi: pqWalletAbi, functionName: "usedLeaves", blockNumber }),
      sepoliaClient.readContract({ address: pq, abi: pqWalletAbi, functionName: "isLeafUsed", args: [BigInt(next)], blockNumber }),
    ]);
    return { deployed: true, used: popcount(used), nextUsed };
  }, atLeast);
}

async function runHelm(name: string, pqWallets: Address[], onStep: (s: string) => void, atLeast = 0n): Promise<HelmReport> {
  for (let i = 0; i < 20 && atLeast > 0n; i++) {
    if ((await sepoliaClient.getBlockNumber().catch(() => 0n)) >= atLeast) break;
    await sleep(2000);
  }
  const tries = atLeast > 0n ? 3 : 1; // right after a transaction, a lagging log node can fail a read: try again
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await helmCheck(sepoliaClient, sepoliaLogs, [mainnetClient], name, { pqWallets, onStep });
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(5000);
    }
  }
  throw last;
}

/** The resolver already belongs to the PQ wallet alone (a handover that stopped after step 2): no new one is needed. */
function resolverIsPqOnly(r: HelmReport, pq: Address) {
  const crew = r.entries.filter((e) => e.path === 4);
  const proven = r.completeness.filter((c) => c.where === `resolver ${r.resolver}`).every((c) => c.complete);
  return r.resolver !== ZERO && crew.length > 0 && crew.every((e) => same(e.holder.address, pq)) && proven;
}

function initialSteps(r: HelmReport, pq: Address): RunStep[] {
  const pqOnly = resolverIsPqOnly(r, pq);
  return handoverPlan(r, pq).map((s) =>
    pqOnly && (s.kind === "resolver" || s.kind === "setResolver") ? { ...s, status: "skip" as const, note: "already done: the name's resolver belongs to the post-quantum wallet" } : { ...s, status: "todo" as const },
  );
}

function verdictOf(r: HelmReport): { tone: "bad" | "good" | "unknown"; label: string; text: string } {
  const held = r.entries.filter((e) => e.path <= 4);
  if (r.verdict === "hijackable")
    return { tone: "bad", label: "Hijackable", text: `On Q-Day it can be steered through path${r.hijackablePaths.length > 1 ? "s" : ""} ${r.hijackablePaths.join(", ")} by keys whose public keys are already on-chain.` };
  if (r.verdict === "unknown") return { tone: "unknown", label: "Unknown", text: "The role list couldn't be proven complete, so it isn't called safe." };
  if (held.length > 0 && held.every((e) => e.holder.exposure === "pq-wallet")) return { tone: "good", label: "Protected", text: "Every key on paths 1 to 4 is a post-quantum wallet." };
  if (held.some((e) => e.holder.exposure === "contract")) return { tone: "unknown", label: "Contract", text: "A contract holds part of the control, so its own signers decide." };
  return { tone: "unknown", label: "Not seen", text: "No key on paths 1 to 4 has revealed its public key yet. Hand the name over before one does." };
}

// ---------------------------------------------------------------- the flow
export default function NameProtect() {
  const supported = serialSupported();
  const hasWallet = !!eth();
  const dev = useRef<SerialDevice | null>(null);
  /** the block of our last receipt: later reads and estimates never come from a node behind it */
  const lastBlock = useRef(0n);
  const [devInfo, setDevInfo] = useState<DeviceInfo | null>(null);
  const [devLocked, setDevLocked] = useState(false); // PIN-locked device: connected, waiting for the PIN
  const [pinInput, setPinInput] = useState("");
  const [treeReady, setTreeReady] = useState(false);
  const [treeProgress, setTreeProgress] = useState(0);
  const [devLog, setDevLog] = useState<string[]>([]);
  const [ws, setWs] = useState<WalletState | null>(null);

  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const [input, setInput] = useState("");
  const [report, setReport] = useState<HelmReport | null>(null);
  const [helmStep, setHelmStep] = useState(0);
  const [run, setRun] = useState<RunStep[] | null>(null);
  const [newResolver, setNewResolver] = useState<Address | null>(null);
  const [handedOver, setHandedOver] = useState(false);
  const [proofDone, setProofDone] = useState(false);
  const [pendingExec, setPendingExec] = useState<{ data: Hex; label: string; leaf: number } | null>(null);

  const [recKind, setRecKind] = useState<"text" | "addr">("text");
  const [recKey, setRecKey] = useState("");
  const [recValue, setRecValue] = useState("");
  const [recAddr, setRecAddr] = useState("");

  const [busy, setBusy] = useState("");
  const [checking, setChecking] = useState("");
  const [stage, setStage] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const note = (text: string, hash?: Hex) => setLog((l) => [{ text, hash }, ...l].slice(0, 16));

  const devRoot = devInfo?.root;
  const devSeed = devInfo?.pubSeed;
  const pqWallet = useMemo(() => (devRoot && devSeed ? pqWalletAddress(devRoot, devSeed) : null), [devRoot, devSeed]);
  const wallet = useMemo(() => (account && eth() ? createWalletClient({ account, chain: sepolia, transport: custom(eth()!) }) : null), [account]);
  const ownedByDevice = !!(report && pqWallet && same(report.owner, pqWallet));
  // a post-quantum wallet already owns it (the Helm check verifies Lifeboat wallets from their own key)
  const ownedByPq = !!report?.entries.some((e) => e.path === 1 && e.holder.exposure === "pq-wallet");
  const isOwner = !!(report && account && same(report.owner, account));
  // the plan reads the same before the device connects; its wallet only has to be left out of the holders
  const plan = useMemo(
    () => (report && !same(report.owner, pqWallet) && report.owner !== ZERO && !ownedByPq ? initialSteps(report, pqWallet ?? ZERO) : null),
    [report, pqWallet, ownedByPq],
  );
  const steps = run ?? plan;
  const leafBlocked = !!ws?.nextUsed;

  useEffect(() => {
    return onWalletEvents({
      accountsChanged: ((a: string[]) => setAccount(a[0] ? getAddress(a[0]) : null)) as (x: never) => void,
      chainChanged: ((c: string) => setChainId(Number(c))) as (x: never) => void,
    });
  }, []);
  // release the port when the page goes away, so the next connect can open it
  useEffect(
    () => () => {
      const d = dev.current;
      dev.current = null;
      if (d) {
        d.onClose = undefined;
        void d.close();
      }
    },
    [],
  );

  const guarded = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    setStage("");
    setErr("");
    try {
      await f();
    } catch (e) {
      setErr(e instanceof DeviceError ? e.message : message(e).slice(0, 300));
    } finally {
      setBusy("");
      setStage("");
    }
  };

  // ---------------------------------------------------------------- 1. device
  const connectDevice = () =>
    guarded("Connecting the ESP32", async () => {
      if (dev.current) {
        const old = dev.current;
        dev.current = null;
        old.onClose = undefined;
        await old.close();
      }
      setDevInfo(null);
      setTreeReady(false);
      setWs(null);
      let d: SerialDevice;
      try {
        d = await SerialDevice.connect();
      } catch (e) {
        throw new Error(openErrorText(e));
      }
      dev.current = d;
      d.onLog = (l) => setDevLog((x) => [...x.slice(-9), l]);
      d.onClose = () => {
        if (dev.current !== d) return;
        dev.current = null;
        setDevInfo(null);
        setTreeReady(false);
        setErr(new DeviceError("disconnected").message);
      };
      const info = await d.readInfo();
      if (!info) throw new DeviceError("no-key");
      setDevLocked(info.locked);
      if (!info.locked) await afterUnlock(d, info);
    });

  /** Once the device can sign: its public tree (memory only) and its post-quantum wallet on Sepolia. */
  const afterUnlock = async (d: SerialDevice, info: DeviceInfo) => {
    setDevInfo(info);
    setBusy("Reading the device's public tree");
    await d.readTree(setTreeProgress);
    setTreeReady(true);
    setBusy("Looking up its post-quantum wallet on Sepolia");
    setWs(await readWalletState(pqWalletAddress(info.root, info.pubSeed), info.next));
  };

  const unlockDevice = () =>
    guarded("Unlocking the ESP32 (it stretches the PIN for a few seconds)", async () => {
      const d = dev.current;
      if (!d) throw new DeviceError("disconnected");
      const pin = pinInput;
      setPinInput("");
      const info = await d.unlock(pin);
      if (!info) throw new DeviceError("no-key");
      setDevLocked(false);
      await afterUnlock(d, info);
    });

  const createWallet = () =>
    guarded("Creating the post-quantum wallet", async () => {
      if (!devInfo || !pqWallet || !wallet || !account) throw new Error("Connect the ESP32 and a wallet first.");
      await ensureSepolia();
      const tx = deployPqWalletTx(devInfo.root, devInfo.pubSeed);
      const gas = ((await estimate(account, tx.to, tx.data)) * 12n) / 10n;
      const hash = await wallet.sendTransaction({ account, chain: sepolia, to: tx.to, data: tx.data, gas });
      note("post-quantum wallet: sent", hash);
      setStage("Waiting for the block…");
      const r = await sepoliaClient.waitForTransactionReceipt({ hash, timeout: 600_000 });
      if (r.status !== "success") throw new Error(`The wallet deployment reverted in block ${r.blockNumber}.`);
      lastBlock.current = r.blockNumber;
      const s = await readWalletState(pqWallet, devInfo.next, r.blockNumber);
      setWs(s);
      if (!s.deployed) throw new Error("The wallet isn't at its address yet. Reconnect the device in a moment to check again.");
      note(`post-quantum wallet ${short(pqWallet)} created in block ${r.blockNumber}`, hash);
    });

  // ---------------------------------------------------------------- 2. wallet
  async function ensureSepolia() {
    let c = Number(await eth()!.request({ method: "eth_chainId" }));
    if (c !== CHAIN) {
      await eth()!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      c = Number(await eth()!.request({ method: "eth_chainId" }));
    }
    setChainId(c);
    if (c !== CHAIN) throw new Error("Switch the wallet to Sepolia.");
  }
  const connectWallet = () =>
    guarded("Connecting the wallet", async () => {
      const [a] = (await eth()!.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(getAddress(a!));
      await ensureSepolia();
    });

  // ---------------------------------------------------------------- 3. name
  const knownPq = () => [...SEPOLIA_PQ_WALLETS, ...(pqWallet ? [pqWallet] : [])] as Address[];
  const onHelmStep = (s: string) => setHelmStep(Math.max(0, HELM_STEPS.indexOf(s)));
  const check = (raw = input) =>
    guarded(HELM, async () => {
      const v = raw.trim();
      if (!/^[^\s]+\.[a-z]+$/i.test(v)) throw new Error("Enter an ENSv2 name on Sepolia (name.eth).");
      let name: string;
      try {
        name = normalize(v);
      } catch {
        throw new Error("That isn't a valid ENS name.");
      }
      setReport(null);
      setRun(null);
      setNewResolver(null);
      setHandedOver(false);
      setProofDone(false);
      setPendingExec(null);
      setHelmStep(0);
      setChecking(name);
      setReport(await runHelm(name, knownPq(), onHelmStep));
    });

  // ---------------------------------------------------------------- 4. handover
  const runHandover = () =>
    guarded("Handing the name over", async () => {
      if (!report || !pqWallet || !devInfo || !wallet || !account) throw new Error("Connect the ESP32 and the owner's wallet first.");
      if (!same(account, report.owner)) throw new Error(`The name's owner is ${report.owner}. Connect that account.`);
      if (!ws?.deployed) throw new Error("Create the post-quantum wallet first (step 1).");
      if (leafBlocked) throw new Error(`Leaf ${devInfo.next} is already used on chain: stop here.`);
      await ensureSepolia();
      const name = report.name;
      const label = name.split(".")[0]!;
      const registry = report.parentRegistry;
      const arr: RunStep[] = (run ?? initialSteps(report, pqWallet)).map((s) => ({ ...s }));
      const show = () => setRun(arr.map((s) => ({ ...s })));
      let resolver: Address | null = newResolver ?? (resolverIsPqOnly(report, pqWallet) ? report.resolver : null);
      let atLeast = lastBlock.current;
      const tokenIdAt = (blockNumber: bigint) => sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "findTokenId", args: [label], blockNumber }) as Promise<bigint>;

      const send = async (i: number, to: Address, data: Hex, floor: bigint) => {
        const est = await estimate(account, to, data, atLeast);
        const gas = (est * 13n) / 10n > floor ? (est * 13n) / 10n : floor; // explicit gas: an estimate from a lagging node can come out low
        setStage("Confirm it in your wallet.");
        const hash = await wallet.sendTransaction({ account, chain: sepolia, to, data, gas });
        arr[i]!.hash = hash;
        show();
        setStage("Waiting for the block…");
        const r = await sepoliaClient.waitForTransactionReceipt({ hash, timeout: 600_000 });
        if (r.status !== "success") throw new Error(`Step ${i + 1} reverted on-chain in block ${r.blockNumber}. Nothing after it was sent.`);
        atLeast = r.blockNumber;
        lastBlock.current = r.blockNumber;
        note(`${i + 1}. ${arr[i]!.kind}: included in block ${r.blockNumber}`, hash);
        return r.blockNumber;
      };

      for (let i = 0; i < arr.length; i++) {
        const s = arr[i]!;
        if (s.status === "done" || s.status === "skip") continue;
        s.status = "now";
        s.note = undefined;
        show();
        setBusy(`Step ${i + 1} of ${arr.length}`);
        try {
          if (s.kind === "resolver") {
            const salt = resolverSalt(name, Date.now());
            const init = resolverInitData(name, pqWallet, devInfo.root, new Date().toISOString());
            const predicted = (await readAt(
              (blockNumber) => sepoliaClient.readContract({ address: ENS.VerifiableFactory, abi: factoryAbi, functionName: "predictProxyAddress", args: [account, salt], blockNumber }),
              atLeast,
            )) as Address;
            const tx = deployResolverTx(salt, init);
            const block = await send(i, tx.to, tx.data, GAS_FLOOR.resolver);
            const code = await readAt((blockNumber) => sepoliaClient.getCode({ address: predicted, blockNumber }), block);
            if (!code || code === "0x") throw new Error(`The new resolver isn't at its predicted address ${predicted}.`);
            resolver = getAddress(predicted);
            setNewResolver(resolver);
            s.note = `resolver ${short(resolver)}`;
          } else if (s.kind === "setResolver") {
            if (!resolver) throw new Error("No new resolver yet: run step 1 first.");
            const tokenId = await readAt(tokenIdAt, atLeast); // the token id changes after role changes: always read it fresh
            const block = await send(i, registry, setResolverData(tokenId, resolver), GAS_FLOOR.setResolver);
            const now = (await readAt((blockNumber) => sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: [label], blockNumber }), block)) as Address;
            if (!same(now, resolver)) throw new Error(`The name still points at ${now}.`);
          } else if (s.kind === "revoke") {
            const { tokenId, bitmap } = await readAt(async (blockNumber) => {
              const tokenId = await tokenIdAt(blockNumber);
              const resource = (await sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "getResource", args: [tokenId], blockNumber })) as bigint;
              const bitmap = (await sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "roles", args: [resource, s.account], blockNumber })) as bigint;
              return { tokenId, bitmap };
            }, atLeast);
            if (bitmap === 0n) {
              s.status = "skip";
              s.note = "no roles left to revoke";
              show();
              continue;
            }
            await send(i, registry, revokeRolesData(tokenId, bitmap, s.account), GAS_FLOOR.revoke);
          } else if (s.kind === "operator") {
            const approved = (await readAt(
              (blockNumber) => sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "isApprovedForAll", args: [account, s.account], blockNumber }),
              atLeast,
            )) as boolean;
            if (!approved) {
              s.status = "skip";
              s.note = "already removed";
              show();
              continue;
            }
            await send(i, registry, removeOperatorData(s.account), GAS_FLOOR.operator);
          } else {
            const tokenId = await readAt(tokenIdAt, atLeast);
            const block = await send(i, registry, transferNameData(account, pqWallet, tokenId), GAS_FLOOR.transfer);
            const owner = (await readAt((blockNumber) => sepoliaClient.readContract({ address: registry, abi: registryAbi, functionName: "findOwner", args: [label], blockNumber }), block)) as Address;
            if (!same(owner, pqWallet)) throw new Error(`The registry reports owner ${owner}.`);
            s.note = "owner: the post-quantum wallet";
          }
          s.status = "done";
          show();
        } catch (e) {
          s.status = "fail";
          s.note = e instanceof Error ? message(e).slice(0, 200) : String(e);
          show();
          throw e;
        }
      }
      setHandedOver(true);
      note(`${name} now belongs to the post-quantum wallet ${short(pqWallet)}`);
    });

  // ---------------------------------------------------------------- 5 and 6: signed on the device
  /** Signs `calls` on the device for the PQ wallet, checks the signature here, then relays it from the connected wallet. */
  async function signAndSend(calls: WalletCall[], label: string): Promise<bigint> {
    const d = dev.current;
    if (!d || !pqWallet) throw new DeviceError("disconnected");
    if (!d.treeReady) throw new DeviceError("no-tree");
    if (!wallet || !account) throw new Error("Connect a wallet to relay the signed change. It pays the gas and gets no control.");
    await ensureSepolia();
    setPendingExec(null);
    setStage("Reading the device's counter…");
    const info = await d.readInfo();
    if (!info) throw new DeviceError("no-key");
    setDevInfo(info);
    const leaf = info.next;
    const s = await readWalletState(pqWallet, leaf, lastBlock.current);
    setWs(s);
    if (!s.deployed) throw new Error("The post-quantum wallet isn't created yet (step 1).");
    if (s.nextUsed) throw new Error(`Leaf ${leaf} is already used on chain: the device's counter is behind its wallet. Stop here.`);
    // the target must accept this change from the PQ wallet, before a leaf is spent on it
    for (const c of calls) {
      try {
        await readAt((blockNumber) => sepoliaClient.call({ account: pqWallet, to: c.target, data: c.data, blockNumber }), lastBlock.current);
      } catch (e) {
        if (!isRevert(e)) throw e;
        throw new Error(`The resolver refuses this change from the post-quantum wallet (${revertText(e)}). Nothing was signed.`);
      }
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const req = pqWalletRequest({ chainId: CHAIN, wallet: pqWallet, leaf, deadline, calls });
    setStage("Finding the counter and sending the request to the device…");
    await sleep(30); // let the label paint before the grind
    const sig = await d.sign(req, leaf, { onAsk: () => setStage(ASK_TEXT) });
    setDevInfo(d.info);
    note(`${label}: signed on the device with leaf ${sig.leaf}, checked here (counter found in ${sig.tries} tries)`);
    const data = executeData(sig.leaf, deadline, calls, sig.witness);
    setPendingExec({ data, label, leaf: sig.leaf });
    return relay(data, label);
  }

  /** Sends a signed execute from the connected wallet (a relayer only: the signature decides). */
  async function relay(data: Hex, label: string): Promise<bigint> {
    if (!wallet || !account || !pqWallet) throw new Error("Connect a wallet to relay the signed change.");
    await ensureSepolia();
    setStage("Checking the signed change against the wallet on Sepolia…");
    const est = await estimate(account, pqWallet, data, lastBlock.current);
    const gas = (est * 13n) / 10n > EXECUTE_GAS ? (est * 13n) / 10n : EXECUTE_GAS;
    setStage("Confirm it in your wallet. It only relays: the device's signature decides.");
    const hash = await wallet.sendTransaction({ account, chain: sepolia, to: pqWallet, data, gas });
    note(`${label}: sent`, hash);
    setStage("Waiting for the block…");
    const r = await sepoliaClient.waitForTransactionReceipt({ hash, timeout: 600_000 });
    if (r.status !== "success") throw new Error(`${label} reverted on-chain in block ${r.blockNumber}.`);
    lastBlock.current = r.blockNumber;
    setPendingExec(null);
    note(`${label}: included in block ${r.blockNumber}`, hash);
    if (devInfo) setWs(await readWalletState(pqWallet, dev.current?.info?.next ?? devInfo.next, r.blockNumber).catch(() => ws));
    return r.blockNumber;
  }

  /** After the proof: the Helm check again, once the node has the proof's block. */
  const afterProof = async (block: bigint) => {
    if (!report) return;
    setProofDone(true);
    setBusy(HELM);
    setHelmStep(0);
    setStage("");
    setChecking(report.name);
    const r = await runHelm(report.name, knownPq(), onHelmStep, block);
    setReport(r);
    setRun(null);
    note(`Helm check after the handover: ${r.verdict}`);
  };

  const resend = () =>
    guarded("Sending the signed change again", async () => {
      if (!pendingExec) return;
      const block = await relay(pendingExec.data, pendingExec.label);
      if (pendingExec.label === PROOF_LABEL && handedOver && !proofDone) await afterProof(block);
    });

  const signProof = () =>
    guarded("Signing the proof on the device", async () => {
      if (!report || !pqWallet) return;
      const resolver = newResolver ?? report.resolver;
      const calls = setTextCalls(resolver, report.name, "pq.checked", `${new Date().toISOString()} signed on the hardware key`);
      await afterProof(await signAndSend(calls, PROOF_LABEL));
    });

  const changeRecord = () =>
    guarded("Signing the change on the device", async () => {
      if (!report) return;
      const resolver = report.resolver;
      if (resolver === ZERO) throw new Error("This name has no resolver.");
      let calls: WalletCall[];
      let label: string;
      if (recKind === "text") {
        const key = recKey.trim();
        if (!key) throw new Error("Enter a record key.");
        if (!/^[\x20-\x7e]*$/.test(key + recValue)) throw new Error("The device's screen shows plain ASCII: use letters, digits and punctuation.");
        calls = setTextCalls(resolver, report.name, key, recValue);
        label = `text ${key}`;
      } else {
        const a = recAddr.trim();
        if (!isAddress(a, { strict: false })) throw new Error("Enter an ETH address (0x…).");
        calls = setAddressCalls(resolver, report.name, getAddress(a));
        label = `ETH address ${short(getAddress(a))}`;
      }
      await signAndSend(calls, label);
    });

  // ---------------------------------------------------------------- view
  const deviceReady = !!devInfo && treeReady && !!dev.current;
  const v = report ? verdictOf(report) : null;
  const runFailed = !!run?.some((s) => s.status === "fail");
  const runDone = !!steps && steps.every((s) => s.status === "done" || s.status === "skip") && handedOver;
  const blockers = [
    !deviceReady && "connect the ESP32",
    deviceReady && ws && !ws.deployed && "create the post-quantum wallet",
    !account && "connect the owner's wallet",
    account && report && !isOwner && `connect the owner ${short(report.owner, 5)}`,
    leafBlocked && "the device's next leaf is used on chain",
  ].filter(Boolean) as string[];

  return (
    <>
      <section className="section np" style={{ marginTop: 26 }}>
        <div className="label">ENS name · hardware key · Sepolia testnet · nothing here touches mainnet</div>
        <h2>
          Protect an ENS name. <span className="o">Sign on the device.</span>
        </h2>
        <p className="lead">
          Hand an ENSv2 name to a post-quantum wallet whose key exists only on your ESP32. From then on every record change is shown on the device's screen in words and signed there after a press of the BOOT
          button. Your wallet only relays and pays gas.
        </p>
        <div className="protect-steps">
          <div className="paper-card">
            <div className="label">1 · Hardware key (ESP32)</div>
            {!supported ? (
              <p className="note">Web Serial needs Chrome or Edge on a desktop. Open this page there to connect the device.</p>
            ) : devLocked && !devInfo ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  unlockDevice();
                }}
              >
                <p style={{ marginTop: 6 }}>
                  <b>This device is PIN-locked.</b> Its key is stored encrypted; enter the PIN to unlock it until it's unplugged.
                </p>
                <div className="passenger" style={{ marginTop: 6 }}>
                  <input type="password" aria-label="Device PIN" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="PIN" autoComplete="off" />
                  <button type="submit" disabled={!!busy || pinInput.length < 4}>
                    Unlock
                  </button>
                </div>
                <p className="note" style={{ marginBottom: 0 }}>
                  The PIN goes over USB to the device only; this page doesn't keep it.
                </p>
              </form>
            ) : !devInfo ? (
              <>
                <button className="cta" onClick={connectDevice} disabled={!!busy}>
                  Connect the ESP32
                </button>
                <p className="note" style={{ marginBottom: 0 }}>
                  Over USB. The secret seed and the leaf counter stay on the device; this page reads only its public key, in memory.
                </p>
              </>
            ) : (
              <>
                <div className="qrows" style={{ marginTop: 6 }}>
                  <div>
                    <span className="label">Key root</span>
                    <b className="mono">{short(devInfo.root, 6)}</b>
                  </div>
                  <div>
                    <span className="label">Next leaf</span>
                    <b className="mono">{devInfo.next} of 256</b>
                  </div>
                  <div>
                    <span className="label">PQ wallet</span>
                    {pqWallet && (
                      <a className="mono" href={sepoliaAddr(pqWallet)} target="_blank" rel="noreferrer">
                        {short(pqWallet, 5)}
                      </a>
                    )}
                  </div>
                  <div>
                    <span className="label">On Sepolia</span>
                    <b>{!ws ? <span className="faint">reading…</span> : ws.deployed ? <Pill status="pq">created · {ws.used} used</Pill> : <Pill status="not-seen">not created yet</Pill>}</b>
                  </div>
                </div>
                {!treeReady && treeProgress > 0 && <p className="note">public tree: {treeProgress}/256 leaves</p>}
                {leafBlocked && (
                  <p className="error-box" style={{ marginBottom: 0 }}>
                    Leaf {devInfo.next} is already used on chain. The device's counter is behind its wallet, so it can't sign safely. Stop here.
                  </p>
                )}
                {ws && !ws.deployed && (
                  <div style={{ marginTop: 10 }}>
                    <button className="cta" onClick={createWallet} disabled={!!busy || !account}>
                      Create my post-quantum wallet
                    </button>
                    <p className="note" style={{ marginBottom: 0 }}>
                      {account ? "One transaction from your wallet. It pays the gas and gets no control: the address follows from the device's key." : "Connect a wallet (step 2) to send it."}
                    </p>
                  </div>
                )}
                <button className="link-btn" onClick={connectDevice} disabled={!!busy} style={{ marginTop: 8 }}>
                  reconnect
                </button>
              </>
            )}
            {devLog.length > 0 && (
              <details className="np-devlog">
                <summary>device log</summary>
                <pre>{devLog.join("\n")}</pre>
              </details>
            )}
          </div>

          <div className="paper-card">
            <div className="label">2 · Wallet</div>
            {!hasWallet ? (
              <p className="note">Install a browser wallet (MetaMask, Rabby…) to send the transactions. The name check works without one.</p>
            ) : account ? (
              <p className="mono">
                {short(account, 5)} · {chainId === CHAIN ? "Sepolia" : <span className="faint">wrong network</span>}
                {report && (isOwner ? <span className="np-you"> · owns {report.name}</span> : null)}
              </p>
            ) : (
              <button className="cta" onClick={connectWallet} disabled={!!busy}>
                Connect wallet
              </button>
            )}
            <p className="note" style={{ marginBottom: 0 }}>
              The name's current owner. After the handover it only relays the device's signatures.
            </p>
          </div>

          <div className="paper-card">
            <div className="label">3 · ENS name on Sepolia</div>
            <form
              className="passenger"
              style={{ boxShadow: "none" }}
              onSubmit={(e) => {
                e.preventDefault();
                check();
              }}
            >
              <input aria-label="ENS name on Sepolia" value={input} onChange={(e) => setInput(e.target.value)} placeholder="name.eth" spellCheck={false} autoComplete="off" />
              <button type="submit" disabled={!!busy}>
                Check
              </button>
            </form>
            <p className="note" style={{ marginBottom: 0 }}>
              The Helm check finds every key that can steer the name, then the plan hands each one over.
            </p>
          </div>
        </div>

        {busy && (
          <div className="board loading" style={{ marginTop: 14 }}>
            <Radar />
            <div>
              <div className="stencil" style={{ fontSize: 26 }}>
                {busy === HELM && checking ? `Helm check: ${checking}` : busy}…
              </div>
              {busy === HELM && <Steps steps={HELM_STEPS} current={helmStep} />}
              {stage && <p className={`np-stage ${stage === ASK_TEXT ? "ask" : ""}`}>{stage}</p>}
            </div>
          </div>
        )}
        {err && <p className="error-box">{err}</p>}
      </section>

      {report && v && (
        <section className="section np grid cols-2">
          <LuggageTag
            tone={report.owner === ZERO ? "neutral" : v.tone}
            verdict={report.owner === ZERO ? "Not found" : v.label}
            id={report.name}
            meta={
              <>
                Sepolia block {report.block.toString()} ·{" "}
                <button className="link-btn" onClick={() => check(report.name)} disabled={!!busy}>
                  check again
                </button>
              </>
            }
          >
            {report.owner === ZERO ? (
              <p className="desc">This name isn't registered in ENSv2 on Sepolia.</p>
            ) : (
              <>
                <p className="desc">{v.text}</p>
                <div className="qrows">
                  <div>
                    <span className="label">Owner</span>
                    <a className="mono" href={sepoliaAddr(report.owner)} target="_blank" rel="noreferrer">
                      {short(report.owner, 5)}
                    </a>
                  </div>
                  <div>
                    <span className="label">Resolver</span>
                    {report.resolver === ZERO ? (
                      <b className="faint">none</b>
                    ) : (
                      <a className="mono" href={sepoliaAddr(report.resolver)} target="_blank" rel="noreferrer">
                        {short(report.resolver, 5)}
                      </a>
                    )}
                  </div>
                </div>
                {ownedByDevice ? (
                  <p className="np-owner good">The owner is this device's post-quantum wallet.</p>
                ) : ownedByPq ? (
                  <p className="np-owner good">
                    Already protected: a post-quantum wallet owns it (<span className="mono">{short(report.owner, 5)}</span>). Connect the device that holds its key to change a record.
                  </p>
                ) : account && !isOwner ? (
                  <p className="np-owner">
                    The owner is <span className="mono">{report.owner}</span>. Connect that account to hand the name over.
                  </p>
                ) : !account ? (
                  <p className="np-owner">
                    Connect the owner's wallet (<span className="mono">{short(report.owner, 5)}</span>) to hand it over.
                  </p>
                ) : null}
                <ul className="np-paths">
                  {[1, 2, 3, 4, 5].map((p) => {
                    const es = report.entries.filter((e) => e.path === p);
                    return (
                      <li key={p}>
                        <span className="n">{p}</span>
                        <span className="t">{PATH_TITLE[p]}</span>
                        <span className="who">
                          {es.length === 0 ? (
                            <span className="nobody-s">nobody</span>
                          ) : (
                            <>
                              {es.slice(0, 3).map((e, i) => (
                                <span key={i} className="h">
                                  <Pill status={e.holder.exposure} />{" "}
                                  <a className="mono" href={sepoliaAddr(e.holder.address)} target="_blank" rel="noreferrer" title={`${e.power.join(", ")} · ${e.holder.detail}`}>
                                    {short(e.holder.address, 4)}
                                  </a>
                                </span>
                              ))}
                              {es.length > 3 && <span className="faint mono">+{es.length - 3} more</span>}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="note" style={{ marginBottom: 0 }}>
                  Path 5 is systemic: the registries above the name, outside the owner's control.
                </p>
              </>
            )}
          </LuggageTag>

          {report.owner === ZERO || (ownedByPq && !ownedByDevice) ? null : ownedByDevice ? (
            <div className="board">
              <div className="board-head">
                <h3>6 · Change a record</h3>
                <span className="label">signed on the device</span>
              </div>
              <div className="board-body protect-actions">
                <p style={{ marginTop: 0 }}>
                  The post-quantum wallet holds the name. Each change goes to the device, which shows it in words; it is signed only after the BOOT press, and your wallet relays it.
                </p>
                <div className="toggle" role="group" aria-label="Record type">
                  <button aria-pressed={recKind === "text"} onClick={() => setRecKind("text")}>
                    Text record
                  </button>
                  <button aria-pressed={recKind === "addr"} onClick={() => setRecKind("addr")}>
                    ETH address
                  </button>
                </div>
                <form
                  className="np-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    changeRecord();
                  }}
                >
                  {recKind === "text" ? (
                    <>
                      <input className="field" aria-label="Record key" placeholder="key" value={recKey} onChange={(e) => setRecKey(e.target.value)} spellCheck={false} autoComplete="off" />
                      <input className="field" aria-label="Record value" placeholder="value" value={recValue} onChange={(e) => setRecValue(e.target.value)} spellCheck={false} autoComplete="off" />
                    </>
                  ) : (
                    <input className="field" aria-label="ETH address" placeholder="0x… address" value={recAddr} onChange={(e) => setRecAddr(e.target.value)} spellCheck={false} autoComplete="off" />
                  )}
                  <button className="cta" type="submit" disabled={!!busy || !deviceReady || !account || leafBlocked}>
                    Sign on the device
                  </button>
                </form>
                <p className="note">
                  Resolver <span className="mono">{short(report.resolver, 5)}</span>
                  {!deviceReady ? " · connect the ESP32 to sign" : !account ? " · connect a wallet to relay" : ` · next leaf ${devInfo?.next}`}
                </p>
                {pendingExec && !busy && (
                  <div className="paper-card">
                    <div className="label">Signed, not sent yet</div>
                    <p style={{ margin: "4px 0 8px" }}>
                      {pendingExec.label}, leaf {pendingExec.leaf}. The signature is valid for an hour.
                    </p>
                    <button className="cta ghost" onClick={resend}>
                      Send it again
                    </button>
                  </div>
                )}
                <LogList log={log} />
              </div>
            </div>
          ) : (
            steps && (
              <div className="board">
                <div className="board-head">
                  <h3>4 · Handover</h3>
                  <span className="label">
                    {steps.filter((s) => s.status !== "skip").length} transactions from the owner · no funds move
                  </span>
                </div>
                <div className="board-body protect-actions">
                  <ol className="np-plan">
                    {steps.map((s, i) => (
                      <li key={`${s.kind}-${i}`} className={s.status}>
                        <span className="mark" aria-hidden="true" />
                        <div>
                          <div>{s.title}</div>
                          {(s.hash || s.note) && (
                            <div className="sub">
                              {s.note}
                              {s.hash && (
                                <>
                                  {s.note ? " · " : ""}
                                  <a className="mono" href={sepoliaTx(s.hash)} target="_blank" rel="noreferrer">
                                    {short(s.hash, 6)} ↗
                                  </a>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {!runDone && (
                    <>
                      <button className="cta" onClick={runHandover} disabled={!!busy || blockers.length > 0}>
                        {runFailed ? `Try again from step ${(run?.findIndex((s) => s.status === "fail") ?? 0) + 1}` : "Run the handover"}
                      </button>
                      {blockers.length > 0 && <p className="note">First: {blockers.join(", ")}.</p>}
                    </>
                  )}
                  {runDone && (
                    <div className="paper-card" style={{ marginTop: 14 }}>
                      <div className="label">5 · Device proof</div>
                      <p style={{ margin: "4px 0 10px" }}>
                        The post-quantum wallet sets <span className="mono">pq.checked</span> on the new resolver, signed on the ESP32. Then the Helm check runs again.
                      </p>
                      {!proofDone && !pendingExec && (
                        <button className="cta" onClick={signProof} disabled={!!busy || !deviceReady || leafBlocked}>
                          Sign the proof on the device
                        </button>
                      )}
                      {pendingExec && !busy && (
                        <button className="cta ghost" onClick={resend}>
                          Send the signed proof again
                        </button>
                      )}
                    </div>
                  )}
                  <LogList log={log} />
                </div>
              </div>
            )
          )}
        </section>
      )}
    </>
  );
}

function LogList({ log }: { log: LogLine[] }) {
  if (!log.length) return null;
  return (
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
  );
}
