import { useEffect, useState } from "react";
import CheckView from "./CheckView";
import EscapeView from "./EscapeView";
import HarbourView from "./HarbourView";
import { REPO } from "./lib";

const TABS = [
  { id: "check", label: "Check" },
  { id: "escape", label: "Escape (EIP-8141)" },
  { id: "harbour", label: "Harbour (Arkiv)" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const fromHash = (): Tab => {
  const h = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "check") as Tab;
};

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 18h26l-4.5 8h-17z" fill="#ff6a2b" />
      <path d="M15 4v13M15 5l8.5 10H15" stroke="#ff6a2b" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M2 28c3 0 3-1.5 6-1.5s3 1.5 6 1.5 3-1.5 6-1.5 3 1.5 6 1.5" stroke="#5b8ccf" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="brand">
            <Logo />
            <h1>Lifeboat</h1>
            <span className="tag">Q-Day readiness</span>
          </div>
          <p className="lede">
            A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Lifeboat shows who could take over what,
            and gives each one a way out.
          </p>
          <p className="small">No quantum computer can do this today. These are readiness findings from public on-chain data.</p>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  window.location.hash = t.id;
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap">
        {tab === "check" && <CheckView />}
        {tab === "escape" && <EscapeView />}
        {tab === "harbour" && <HarbourView />}
      </main>
      <footer>
        <div className="wrap">
          <span>Built from scratch at ETHGlobal Mumbai 2026 · MIT</span>
          <span>
            <a href={REPO}>Source</a> · <a href={`${REPO}/blob/main/docs/helm-check.md`}>Helm check</a> · <a href={`${REPO}/blob/main/docs/ai-usage.md`}>AI usage</a>
          </span>
        </div>
      </footer>
    </>
  );
}
