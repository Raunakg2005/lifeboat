import { useEffect, useState } from "react";
import CheckView from "./CheckView";
import EscapeView from "./EscapeView";
import HarbourView from "./HarbourView";
import DiscoverView from "./DiscoverView";
import HomeView from "./HomeView";
import ProtectView from "./ProtectView";
import TabBoundary from "./TabBoundary";
import { REPO } from "./lib";
import { WaveBand } from "./ui";

const TABS = [
  { id: "home", label: "Home" },
  { id: "check", label: "Scan" },
  { id: "discover", label: "Discover" },
  { id: "escape", label: "Escape" },
  { id: "protect", label: "Protect" },
  { id: "harbour", label: "Harbour" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const fromHash = (): Tab => (TABS.find((t) => t.id === window.location.hash.replace("#", ""))?.id ?? "home") as Tab;

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

  const go = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <a className="wordmark" href="#home" onClick={() => go("home")}>
            <b>LIFEBOAT</b>
            <span>Q-Day readiness · Port of Mumbai</span>
          </a>
          <nav className="nav" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <WaveBand />
      <main className="wrap">
        {/* keyed by tab: an error stays inside its tab, and switching tabs starts the next one clean */}
        <TabBoundary key={tab} name={TABS.find((t) => t.id === tab)!.label}>
          {tab === "home" && <HomeView onGo={go} />}
          {tab === "check" && <CheckView onGo={go} />}
          {tab === "discover" && <DiscoverView />}
          {tab === "escape" && <EscapeView />}
          {tab === "protect" && <ProtectView />}
          {tab === "harbour" && <HarbourView />}
        </TabBoundary>
      </main>
      <footer>
        <div className="hazard" />
        <div className="wrap">
          <span>Built from scratch at ETHGlobal Mumbai 2026 · MIT · No quantum computer can do this today: readiness findings from public on-chain data.</span>
          <span>
            <a href={REPO}>Source</a> · <a href={`${REPO}/blob/main/docs/helm-check.md`}>Helm check</a> · <a href={`${REPO}/blob/main/docs/pq-account.md`}>PQ account</a> ·{" "}
            <a href={`${REPO}/blob/main/arkiv/schema.md`}>Registry</a> · <a href={`${REPO}/blob/main/docs/ai-usage.md`}>AI usage</a>
          </span>
        </div>
      </footer>
    </>
  );
}
