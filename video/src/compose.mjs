// Runs compose.py with a Python that has PyAV (H.264 + AAC) and numpy, then deletes the captured frames
// (about 1.5 GB per take) unless --keep-frames is given.
// Set VIDEO_PYTHON to choose the Python; the default is the local faster-whisper venv.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.env.VIDEO_PYTHON, join(process.env.LOCALAPPDATA ?? "", "Temp", "fdo", "venv", "Scripts", "python.exe"), "python"].filter(Boolean);
const py = candidates.find((c) => c === "python" || existsSync(c));
execFileSync(py, ["-I", join(ROOT, "src", "compose.py"), join(ROOT, "cache"), join(ROOT, "out")], { stdio: "inherit" });
if (!process.argv.includes("--keep-frames")) {
  rmSync(join(ROOT, "cache", "frames"), { recursive: true, force: true });
  console.log("deleted cache/frames (pass --keep-frames to keep them for another compose)");
}
