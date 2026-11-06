// The submission video's script: you read it aloud (ETHGlobal requires a real voice), the recorder paces the
// screen to it. About 3 minutes at a calm pace. Every number is read from the evidence files, nothing typed in.
// No real person's name is shown: real ENS names appear only as the survey's totals, and the handover is shown on
// our own test name, said to be ours.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p) => JSON.parse(readFileSync(join(REPO, p), "utf8"));
const survey = json("evidence/ens/survey.json");
const councils = json("evidence/discovery/councils.json").results;
const op = councils.find((c) => c.label.startsWith("Optimism"));
const nested = councils.flatMap((c) => c.owners.map((o) => o.nested)).find((n) => n && n.threshold === 8);
const guard = json("evidence/guard/quantum-guard.json");

export const SEGMENTS = [
  {
    id: "home",
    label: "Home",
    title: "The problem",
    lines: [
      "Every time you sign anything on Ethereum, your public key goes on-chain.",
      "A future quantum computer could turn that public key into your private key.",
      "Lifeboat shows who could take over what on Q-Day, and gets them out. No quantum computer can do this today: this is about getting ready.",
    ],
    act: async (p, at) => {
      await p.goHome();
      await at(0.75, () => p.scrollToText("Six stops", -60));
    },
  },
  {
    id: "discover",
    label: "Discover",
    title: "Keys revealed by signatures",
    lines: [
      "Multisig signers publish their key every time they sign, even if they never send a transaction.",
      `Counting signatures, Optimism's Security Council goes from ${op.exposedByNonce} to ${op.exposedTotal} of ${op.owners.length} public keys, and Base's nested council from ${nested.exposedByNonce} to ${nested.exposedTotal}.`,
    ],
    act: async (p, at) => {
      await p.tab("Discover");
      await at(0.45, () => p.scrollToText("Optimism Security Council", -70));
    },
  },
  {
    id: "safe",
    label: "Scan · Safe",
    title: "Any Safe, live",
    lines: ["This works for any Safe. Paste its address, and Lifeboat recovers every signer's key from the Safe's own signatures, live, in a few seconds."],
    act: async (p, at) => {
      await p.tab("Scan");
      await p.clickText("a security council");
      await at(0.55, () => p.scrollToSel(".seal", -120));
    },
  },
  {
    id: "names",
    label: "Scan · ENS",
    title: "Names: who can steer them",
    lines: [
      "Names too. Lifeboat checks all five ways to control an ENS v2 name, and proves the list is complete.",
      `Across real names on Sepolia, one per owner, ${survey.verdicts.hijackable} of ${survey.checked} can be steered on Q-Day, ${survey.resolverExposed} of them through their resolver.`,
      "Here's the way out, on our own test name: the registry refused a naive transfer, accepted our handover, and now a post-quantum wallet holds every path.",
    ],
    act: async (p, at) => {
      await p.scrollTo(0);
      await p.clickText("ENS name");
      await at(0.3, () => p.scrollToSel(".survey-line", -380));
      await at(0.55, () => p.type("lifeboatpq.eth"));
      await at(0.72, () => p.scrollToSel(".helm", -150));
    },
  },
  {
    id: "account",
    label: "Escape",
    title: "A post-quantum account",
    lines: ["To get out, Lifeboat gives you a post-quantum account: an EIP-8141 transaction that checks a hash-based signature in its own verify frame, for about 52,000 gas."],
    act: async (p, at) => {
      await p.tab("Escape");
      await at(0.5, () => p.scrollToText("First post-quantum transaction", -120));
    },
  },
  {
    id: "rescue",
    label: "Escape · rescue",
    title: "No ETH? Still escapes",
    lines: [
      "If your wallet holds tokens but no ETH, a staked paymaster pays the gas, and is repaid in USDC in the same transaction.",
      "The public mempool refuses it, the unstaked alternative mempool refuses it, and the staked one includes it.",
    ],
    act: async (p) => {
      await p.scrollToText("The rescue");
    },
  },
  {
    id: "guard",
    label: "Escape · Quantum Guard",
    title: "Protect a Safe in place",
    lines: [
      "Councils can't just move their funds. Quantum Guard adds a post-quantum co-signer to the Safe they already have.",
      `On a real Safe, a payment signed only by the owners was refused on-chain, with ${guard.attackRevert === "MissingPQSignature" ? "a missing post-quantum signature" : "an error"}, and the co-signed payment went through. It covers off-chain signatures like Permit2 too.`,
    ],
    act: async (p, at) => {
      await p.scrollToText("Quantum Guard.", -60);
      await at(0.5, () => p.scrollToText("Same Safe, three tries", -80));
    },
  },
  {
    id: "forgery",
    label: "Escape · forgery",
    title: "One-time means one time",
    lines: ["One-time keys must stay one-time. A wallet that re-signed twelve fee bumps with one key was forged in a tenth of a second, live on the devnet."],
    act: async (p) => {
      await p.scrollToText("Why one-time means one time");
    },
  },
  {
    id: "hardware",
    label: "Escape · hardware",
    title: "Sign safely",
    lines: ["So our signer keeps the key counter on a small device, saves it before every signature, and asks for a button press."],
    act: async (p) => {
      await p.scrollToText("Sign safely");
    },
  },
  {
    id: "close",
    label: "Harbour",
    title: "Publish, and the close",
    lines: [
      "Every finding is re-checked and published to a public registry on Arkiv, with full evidence on Swarm.",
      "The tools and data are free. Protocols pay for monitoring and help migrating.",
      "Lifeboat: get off before Q-Day.",
    ],
    act: async (p, at) => {
      await p.tab("Harbour");
      await at(0.6, () => p.tab("Home"));
    },
  },
];
