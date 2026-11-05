// The walkthrough script: one entry per beat. `lines` are shown as captions exactly as written;
// the TTS reads them through `spoken()`, which spells out acronyms and names.
// `act(page, at, dur)` drives the app while the narration plays; `at(fraction, fn)` runs fn at that
// fraction of the beat's narration time.

export const SEGMENTS = [
  {
    id: "home",
    label: "Home",
    title: "Lifeboat: get off before Q-Day",
    lines: [
      "This is Lifeboat.",
      "A future quantum computer will be able to take over any wallet whose public key is on-chain.",
      "And every signature puts the public key there, not just sending a transaction.",
      "Lifeboat shows who could take over what on Q-Day, and gives each one a way out.",
      "No quantum computer can do this today. Everything you'll see is readiness data, built from public on-chain information.",
    ],
    act: async (p, at) => {
      await p.goHome();
      await at(0.82, () => p.scrollBy(260));
    },
  },
  {
    id: "problem",
    label: "Home · the problem",
    title: "Three things to know, and the route out",
    lines: [
      "Three things to know.",
      "One: your address hides your public key until you sign, and one signature reveals it forever.",
      "Two: today's checkers only count transactions, so they miss multisig signers, who sign without ever sending one.",
      "Three: getting out is hard. Many wallets hold tokens but no ETH for gas, a transferred name keeps its old controllers, and a one-time key fails the moment it signs twice.",
      "Lifeboat's route out has six stops: detect, map, escape, rescue, sign safely, and publish.",
      "Every stop is live, and every claim links its transaction.",
    ],
    act: async (p, at) => {
      await p.scrollToText("Three things");
      await at(0.6, () => p.scrollToText("Six stops"));
      await at(0.88, () => p.scrollToText("Proof on-chain"));
    },
  },
  {
    id: "discover",
    label: "Discover · Ethereum mainnet",
    title: "Detect: keys revealed by multisig signatures",
    lines: [
      "Stop one: detect. This is the Discover tab, on Ethereum mainnet.",
      "For each security council Safe, Lifeboat reads the owners and checks every owner's nonce on five chains.",
      "Then it decodes the signatures inside every executed Safe transaction, and recovers each signer's public key.",
      "By nonce, Optimism's Security Council shows 4 public keys. Counting signatures, all 13 of 13 are public.",
      "Base's nested 8-of-11 council goes from 0 to 11.",
      "The proof box shows one example you can check yourself: a signer with zero transactions, whose public key comes straight out of a Safe signature on Etherscan.",
    ],
    act: async (p, at) => {
      await p.tab("Discover");
      await at(0.45, () => p.scrollToText("Optimism Security Council", -70));
      await at(0.78, () => p.scrollToText("one example", -40));
    },
  },
  {
    id: "helm",
    label: "Scan · Sepolia ENSv2",
    title: "Map: who can steer lifeboatdemo.eth?",
    lines: [
      "Stop two: map. If a quantum-breakable key can still steer your ENS name, an attacker can point the name at their own address.",
      "In ENSv2, control is spread over five paths: the owner, delegates with roles, operators, the resolver's role holders, and the parent registries.",
      "The Helm check rebuilds every role holder from the registry's logs, and proves the list is complete: the holders' role bits must add up to the registry's own role count.",
      "For lifeboatdemo.eth, four paths are held by keys whose public keys are already on-chain. Verdict: hijackable on Q-Day.",
    ],
    act: async (p, at) => {
      await p.tab("Scan");
      await p.clickText("lifeboatdemo.eth (hijackable)");
      await at(0.12, () => p.scrollToSel(".helm", -150));
      await at(0.56, () => p.scrollToText("Is the crew list complete", -160));
      await at(0.86, () => p.scrollToSel(".helm", -150));
    },
  },
  {
    id: "handover",
    label: "Scan · Sepolia ENSv2",
    title: "lifeboatpq.eth: handed over to a post-quantum wallet",
    lines: [
      "This one, lifeboatpq.eth, has been handed over.",
      "The registry refused the naive transfer, because another account still held roles on the name.",
      "Lifeboat deployed a fresh resolver, pointed the name at it, revoked the delegate and removed the operator. Then the registry accepted the transfer.",
      "Now a post-quantum wallet holds every path, and it signed its own pq.checked record with a hash-based signature.",
    ],
    act: async (p, at) => {
      await p.scrollTo(0);
      await p.clickText("lifeboatpq.eth (handed over)");
      await at(0.15, () => p.scrollToSel(".helm", -150));
      await at(0.78, () => p.scrollBy(260));
    },
  },
  {
    id: "account",
    label: "Escape · EIP-8141 devnet",
    title: "Escape: a post-quantum account on EIP-8141",
    lines: [
      "Stop three: escape. EIP-8141 frame transactions let an account run its own signature check, in a verify frame.",
      "Our account, written in Yul, checks a WOTS+C signature: a hash-based one-time signature that quantum computers can't break.",
      "It costs about 52,000 gas, the same for every signature, because the signer fixes the digit sum at 560, so the verifier always does exactly 400 hashes.",
      "256 one-time keys sit under one Merkle root, and an on-chain leaf floor retires every key that's been used.",
    ],
    act: async (p, at) => {
      await p.tab("Escape");
      await at(0.55, () => p.scrollToText("First post-quantum transaction", -120));
    },
  },
  {
    id: "rescue",
    label: "Escape · the rescue",
    title: "Rescue: public ❌ · unstaked ❌ · staked ✅",
    lines: [
      "Stop four: rescue. Many exposed wallets hold tokens but no ETH for gas.",
      "Our rescue paymaster pays the gas, and is repaid in USDC inside the same transaction.",
      "To do that, it reads its own registry and a token balance during validation.",
      "The public mempool refuses that. The alternative mempool refuses it while the paymaster is unstaked, and includes it once the paymaster is staked.",
      "The paymaster also refuses five attack variants, such as underpaying, or sweeping the tokens first.",
    ],
    act: async (p, at) => {
      await p.scrollToText("The rescue");
      await at(0.78, () => p.scrollToText("The sponsor can't be cheated", -120));
    },
  },
  {
    id: "forgery",
    label: "Escape · the forgery",
    title: "Why one-time means one time",
    lines: [
      "Here's why one-time must mean one time. Every fee bump is a new message.",
      "A naive wallet re-signed one payment twelve times with the same one-time key.",
      "From those public signatures alone, an attacker forged a signature for its own transaction in under a tenth of a second, and the account's verify frame accepted it.",
      "We drained the naive wallet on the live devnet. Lifeboat uses a fresh key for every attempt, saved to disk before the signature leaves.",
    ],
    act: async (p, at) => {
      await p.scrollToText("Why one-time means one time");
      await at(0.6, () => p.scrollBy(300));
    },
  },
  {
    id: "hardware",
    label: "Escape · sign safely",
    title: "Sign safely: the ESP32 signer",
    lines: [
      "Stop five: sign safely. The signer keeps the secret seed and the key counter on a small ESP32 board.",
      "It shows each request on its screen, waits for a button press, and saves the counter before it signs anything.",
      "A crash or a reset can waste a key, but the device signs with each key only once.",
      "A transaction signed on this device was included on the devnet.",
    ],
    act: async (p) => {
      await p.scrollToText("Sign safely");
    },
  },
  {
    id: "harbour",
    label: "Harbour · Arkiv + Swarm",
    title: "Publish: the public Q-Day registry",
    lines: [
      "Stop six: publish. The Harbour is a public registry on Arkiv.",
      "Every finding is re-checked on-chain before it's written, and readings expire after 24 hours unless they're checked again.",
      "The logbook is a one-time key ledger that anyone can write to. When one key signs two different messages, it raises 'signed twice', and it caught the naive wallet.",
      "The full evidence bundles live on Swarm.",
    ],
    act: async (p, at) => {
      await p.tab("Harbour");
      await at(0.5, () => p.scrollToText("Logbook", -120));
    },
  },
  {
    id: "close",
    label: "Home · who it's for",
    title: "Free to check, paid to protect",
    lines: [
      "The tools and the data are open and free.",
      "Protocols with upgrade keys, like rollups, bridges and security councils, pay for monitoring, a readiness assessment and help migrating. Wallets pay for the API.",
      "That's Lifeboat: find who's exposed, and get them out before Q-Day.",
    ],
    act: async (p, at) => {
      await p.tab("Home");
      await p.scrollToText("Free to check", -60);
      await at(0.7, () => p.scrollToText("Board the", -200));
    },
  },
];

// How the voice should say things (captions keep the written form).
const SAY = [
  [/lifeboatdemo\.eth/g, "lifeboat demo dot eth"],
  [/lifeboatpq\.eth/g, "lifeboat P Q dot eth"],
  [/pq\.checked/g, "P Q dot checked"],
  [/\bEIP-8141\b/g, "E I P eighty-one forty-one"],
  [/\bWOTS\+C\b/g, "wots plus C"],
  [/\bENSv2\b/g, "E N S version two"],
  [/\bENS\b/g, "E N S"],
  [/\bETH\b/g, "E T H"],
  [/\bUSDC\b/g, "U S D C"],
  [/\bAPI\b/g, "A P I"],
  [/\bESP32\b/g, "E S P thirty-two"],
  [/\bArkiv\b/g, "Archive"],
  [/\bYul\b/g, "Yule"],
  [/\bQ-Day\b/g, "Q Day"],
  [/(\d+)-of-(\d+)/g, "$1 of $2"],
  [/'signed twice'/g, "signed twice"],
];
export const spoken = (s) => SAY.reduce((t, [re, to]) => t.replace(re, to), s);
