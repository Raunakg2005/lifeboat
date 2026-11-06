import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// After a redeploy, a page that was already open can ask for a chunk file the new deployment no longer has (each
// build gives its files new names). Load the new build once instead of failing; a second failure within a minute
// shows the error as usual, so a real outage never turns into a reload loop.
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "lifeboat.chunk-reload-at";
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // no session storage: leave the error to the page
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
