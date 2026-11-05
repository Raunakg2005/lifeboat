import { useEffect, useState } from "react";
import CheckView from "./CheckView";
import EscapeView from "./EscapeView";
import HarbourView from "./HarbourView";
import { REPO } from "./lib";

const TABS = [
  { id: "check", label: "Scan" },
  { id: "escape", label: "Escape" },
  { id: "harbour", label: "Harbour" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const fromHash = (): Tab => (TABS.find((t) => t.id === window.location.hash.replace("#", ""))?.id ?? "check") as Tab;

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 18h26l-4.5 8h-17z" fill="#ff6a2b" />
      <path d="M15 4v13M15 5l8.5 10H15" stroke="#ff6a2b" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M2 28.5c3 0 3-1.5 6-1.5s3 1.5 6 1.5 3-1.5 6-1.5 3 1.5 6 1.5" stroke="#5ad1ff" strokeWidth="1.5" fill="none" />
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
  useEffect(() => {
    window.scrollTo({ top: 0 }); // newer Chromium returns a Promise here, so don't return it as the effect's cleanup
  }, [tab]);

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <a className="brand" href="#check" onClick={() => setTab("check")} style={{ textDecoration: "none" }}>
            <Mark /> Lifeboat <small>Q-Day ready</small>
          </a>
          <nav className="nav" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
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
          <a className="gh" href={REPO} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </div>
      </header>
      <main>
        {tab === "check" && <CheckView />}
        {tab === "escape" && <EscapeView />}
        {tab === "harbour" && <HarbourView />}
      </main>
      <footer>
        <div className="wrap">
          <span>Built from scratch at ETHGlobal Mumbai 2026 · MIT · No quantum computer can do this today.</span>
          <span>
            <a href={`${REPO}/blob/main/docs/helm-check.md`}>Helm check</a> · <a href={`${REPO}/blob/main/docs/pq-account.md`}>PQ account</a> · <a href={`${REPO}/blob/main/arkiv/schema.md`}>Registry</a> ·{" "}
            <a href={`${REPO}/blob/main/docs/ai-usage.md`}>AI usage</a>
          </span>
        </div>
      </footer>
    </>
  );
}
