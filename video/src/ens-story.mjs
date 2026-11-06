// "ENS control, explained": a short explainer for the team (synthetic voice, captions on). Scenes come from
// ens-explainer.html, then the real app. Numbers are read from the survey evidence.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export { spoken } from "./narration.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const survey = JSON.parse(readFileSync(join(REPO, "evidence", "ens", "survey.json"), "utf8"));
const n = (x) => x.toLocaleString("en-US");

export const SEGMENTS = [
  {
    id: "name",
    label: "1 · What a name does",
    title: "A name is where money goes",
    lines: [
      "Here's the ENS part of Lifeboat, in plain words.",
      "An ENS name is where money goes. Someone pays alice.eth, and the name tells their wallet which address to send it to.",
      "So whoever can change where the name points can change where the money goes.",
    ],
    act: async (p) => {
      await p.explainer(1);
    },
  },
  {
    id: "hands",
    label: "2 · Who can steer it",
    title: "Five hands on the wheel",
    lines: [
      "In ENSv2, five different hands can steer a name.",
      "One, the owner, who holds the name itself. Two, helpers, who were given roles like changing the resolver. Three, operators, allowed to move all of the owner's names.",
      "Four, the resolver crew, who can change the address the name points to. And five, the port authority: the registry above .eth.",
    ],
    act: async (p) => {
      await p.explainer(2);
      await p.run("hands(['base','base','base','base','base'])");
    },
  },
  {
    id: "exposed",
    label: "2 · Who can steer it",
    title: "A hand is only as safe as its key",
    lines: [
      "Each hand is held by a key. If a key has ever signed anything, its public key is on the blockchain.",
      "A future quantum computer could turn that public key into the private key. Then the attacker holds that hand, and can point the name at their own address.",
    ],
    act: async (p, at) => {
      await at(0.25, () => p.run("hands(['exp','base','base','base','base'])"));
      await at(0.5, () => p.run("hands(['exp','exp','base','exp','base'])"));
    },
  },
  {
    id: "trap",
    label: "3 · The resolver trap",
    title: "Moving the name isn't enough",
    lines: [
      "Here's the trap. Say you move the name itself to a safe wallet.",
      "The resolver, which holds the address records, doesn't move with it. The old key still controls it, and can still redirect every payment.",
    ],
    act: async (p, at) => {
      await p.explainer(3);
      await at(0.3, () => p.run("trap(1)"));
      await at(0.62, () => p.run("trap(2)"));
    },
  },
  {
    id: "check",
    label: "4 · The Helm check",
    title: "Find every hand, prove none is missing",
    lines: [
      "Lifeboat's Helm check finds every hand. It finds the name's registry and resolver, and reads every roles-changed event, to rebuild who holds what.",
      "ENS only stores how many roles exist, not who has them. So we add up what we found, and it must match the registry's own total. That's the 'proven complete' stamp: no hand is missed.",
      "Then it checks each key. Any exposed key on hands one to four means the name is hijackable on Q-Day.",
    ],
    act: async (p, at) => {
      await p.explainer(4);
      await p.run("steps('hc', 1)");
      await at(0.12, () => p.run("steps('hc', 2)"));
      await at(0.4, () => p.run("steps('hc', 3)"));
      await at(0.72, () => p.run("steps('hc', 4)"));
      await at(0.85, () => p.run("steps('hc', 5)"));
    },
  },
  {
    id: "handover",
    label: "5 · The way out",
    title: "A handover the registry checks",
    lines: [
      "And here's the way out, on our own test name, lifeboatpq.eth.",
      "A plain transfer was refused by the registry itself, because a helper still held a role. That's ENS's own safety net.",
      "So we gave the post-quantum wallet a fresh resolver, pointed the name at it, and removed the helper and the operator. Then the registry accepted the transfer.",
      "Finally, the new wallet signed its own record, with a quantum-safe signature.",
    ],
    act: async (p, at) => {
      await p.explainer(5);
      await p.run("steps('ho', 0)");
      await at(0.12, () => p.run("steps('ho', 1)"));
      await at(0.42, () => p.run("steps('ho', 2)"));
      await at(0.52, () => p.run("steps('ho', 3)"));
      await at(0.62, () => p.run("steps('ho', 4)"));
      await at(0.74, () => p.run("steps('ho', 5)"));
      await at(0.86, () => p.run("steps('ho', 6)"));
    },
  },
  {
    id: "real",
    label: "6 · Real names today",
    title: "About 9 in 10",
    lines: [
      `On real names, one per owner and none of ours, ${n(survey.verdicts.hijackable)} out of ${n(survey.checked)} have an exposed hand today, ${n(survey.resolverExposed)} of them through the resolver trap.`,
      "No quantum computer can do this today. This is about getting ready.",
    ],
    act: async (p) => {
      await p.explainer(6);
    },
  },
  {
    id: "app",
    label: "In the app",
    title: "Scan → ENS name",
    lines: [
      "Here it is in the app. In the Scan tab, choose ENS name, and type the name.",
      "The wheel shows all five hands. For our handed-over name, every hand that matters is green: a post-quantum wallet holds it.",
      "And both role lists are proven complete.",
    ],
    act: async (p, at) => {
      await p.goApp("check");
      await p.clickText("ENS name");
      await p.type("lifeboatpq.eth");
      await at(0.3, () => p.scrollToSel(".helm", -150));
      await at(0.82, () => p.scrollToText("Is the crew list complete", -160));
    },
  },
  {
    id: "ask",
    label: "For the ENS team",
    title: "The one line",
    lines: [
      "So, the one line for ENS: Lifeboat makes sure a quantum computer can't steal your name, and moves it to safety, in a way the registry itself checks.",
    ],
    act: async (p) => {
      await p.explainer(6);
    },
  },
];
