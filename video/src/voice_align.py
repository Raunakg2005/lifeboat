"""Turns the recorded voice-over parts into one clean clip per script line, for the screen recording to pace itself to.

1. Aligns the transcript words (transcribe_voice.py) to the script lines with a global alignment (Needleman-Wunsch on
   normalised words: exact match, near match, gaps for the extra words you said, like the beat titles).
2. Cuts each line from its recording: the first to the last aligned word, with a little air, never into a
   neighbouring line's words.
3. Cleans it: FFmpeg high-pass (80 Hz) and FFT noise reduction, then every line levelled to the same loudness with
   short fades.
4. Writes cache/submission/voice/line-NN.wav and cache/submission/timeline-audio.json (what record.mjs --voice reads).
Usage: python voice_align.py <video dir>
"""
import difflib
import json
import os
import re
import sys
import wave

import av
import numpy as np
from av.audio.resampler import AudioResampler

ROOT = sys.argv[1]
CACHE = os.path.join(ROOT, "cache", "submission")
RATE = 48000
words_by_part = json.load(open(os.path.join(ROOT, "cache", "voice-words.json"), encoding="utf-8"))
# the script's lines and beat titles: script.json (written by voice.mjs from submission.mjs), else the last recording
SCRIPT_JSON = os.path.join(CACHE, "script.json")
tl = json.load(open(SCRIPT_JSON if os.path.exists(SCRIPT_JSON) else os.path.join(CACHE, "timeline.json"), encoding="utf-8"))
lines = tl["lines"]


def norm(s):
    s = s.lower().replace(",", "")
    s = re.sub(r"[^a-z0-9.]+", " ", s)
    return [w.strip(".") for w in s.split() if w.strip(".")]


# script tokens, each tagged with its line; the beat titles are in it too (as ("T", k)), so when you read a title out
# it is aligned to the title, and never cut into a line
seg_order = []
for l in lines:
    if not seg_order or seg_order[-1] != l["seg"]:
        seg_order.append(l["seg"])
titles = {sid: tl["chapters"][k]["title"] for k, sid in enumerate(seg_order)}
script = []
for i, l in enumerate(lines):
    if i == 0 or lines[i - 1]["seg"] != l["seg"]:
        script += [(w, ("T", l["seg"])) for w in norm(titles[l["seg"]])]
    script += [(w, i) for w in norm(l["text"])]
trans = []  # (token, part, start, end)
for p, part in enumerate(words_by_part):
    for w in part["words"]:
        for t in norm(w["w"]):
            trans.append((t, p, w["s"], w["e"]))

n, m = len(script), len(trans)
GAP = -0.6


def sim(a, b):
    if a == b:
        return 2.0
    r = difflib.SequenceMatcher(None, a, b).ratio()
    return 1.0 if r >= 0.75 else -1.0


score = np.zeros((n + 1, m + 1))
back = np.zeros((n + 1, m + 1), dtype=np.int8)  # 1 diag, 2 up (skip script word), 3 left (skip spoken word)
score[1:, 0] = GAP * np.arange(1, n + 1)
score[0, 1:] = GAP * np.arange(1, m + 1)
back[1:, 0], back[0, 1:] = 2, 3
for i in range(1, n + 1):
    a = script[i - 1][0]
    for j in range(1, m + 1):
        d = score[i - 1, j - 1] + sim(a, trans[j - 1][0])
        u = score[i - 1, j] + GAP
        l = score[i, j - 1] + GAP
        if d >= u and d >= l:
            score[i, j], back[i, j] = d, 1
        elif u >= l:
            score[i, j], back[i, j] = u, 2
        else:
            score[i, j], back[i, j] = l, 3
pairs = []
i, j = n, m
while i > 0 or j > 0:
    b = back[i, j]
    if b == 1:
        if sim(script[i - 1][0], trans[j - 1][0]) > 0:
            pairs.append((i - 1, j - 1))
        i, j = i - 1, j - 1
    elif b == 2:
        i -= 1
    else:
        j -= 1
pairs.reverse()

spans = []
for li in range(len(lines)):
    js = [j for (i, j) in pairs if script[i][1] == li]
    total = sum(1 for w in script if w[1] == li)
    if not js:
        spans.append(None)
        continue
    parts = [trans[j][1] for j in js]
    part = max(set(parts), key=parts.count)
    js = [j for j in js if trans[j][1] == part]
    spans.append({"part": part, "j0": min(js), "j1": max(js), "matched": len(js), "total": total})

# a misheard word at either end of a line ("chain" heard as "change") isn't aligned, but it runs on without a pause:
# give it to the line. Words after a pause (the beat titles you read out) stay out.
owned = {j for sp in spans if sp for j in range(sp["j0"], sp["j1"] + 1)}
title_js = {j for (i, j) in pairs if isinstance(script[i][1], tuple)}  # spoken beat titles
owned |= title_js
near_title = lambda j: any(k in title_js for k in range(j + 1, min(m, j + 4)))  # the start of a title that was misheard
print("titles heard:", " / ".join(" ".join(trans[j][0] for (i, j) in pairs if script[i][1] == ("T", sid)) or "-" for sid in seg_order))
for sp in spans:
    if not sp:
        continue
    while sp["j1"] + 1 < m and sp["j1"] + 1 not in owned and not near_title(sp["j1"] + 1) and trans[sp["j1"] + 1][1] == sp["part"] and trans[sp["j1"] + 1][2] - trans[sp["j1"]][3] < 0.35:
        sp["j1"] += 1
        owned.add(sp["j1"])
    while sp["j0"] - 1 >= 0 and sp["j0"] - 1 not in owned and trans[sp["j0"] - 1][1] == sp["part"] and trans[sp["j0"]][2] - trans[sp["j0"] - 1][3] < 0.2:
        sp["j0"] -= 1
        owned.add(sp["j0"])


def load(path):
    """Decodes a part at 48 kHz mono, through FFmpeg's high-pass and FFT noise reduction when available."""
    with av.open(path) as c:
        st = c.streams.audio[0]
        try:
            g = av.filter.Graph()
            src = g.add_abuffer(template=st)
            chain = [g.add("highpass", "f=80"), g.add("afftdn", "nf=-28"), g.add("aformat", f"sample_fmts=flt:sample_rates={RATE}:channel_layouts=mono")]
            sink = g.add("abuffersink")
            prev = src
            for f in chain + [sink]:
                prev.link_to(f)
                prev = f
            g.configure()
            out = []
            for fr in c.decode(st):
                g.push(fr)
                while True:
                    try:
                        out.append(g.pull().to_ndarray().reshape(-1))
                    except (BlockingIOError, av.error.EOFError):
                        break
            g.push(None)
            while True:
                try:
                    out.append(g.pull().to_ndarray().reshape(-1))
                except (BlockingIOError, av.error.EOFError):
                    break
            print(f"  {os.path.basename(path)}: high-pass 80 Hz + noise reduction")
            return np.concatenate(out).astype(np.float32)
        except Exception as e:  # plain decode if the filter graph isn't available
            print(f"  {os.path.basename(path)}: filters unavailable ({e}); plain decode")
    res = AudioResampler(format="flt", layout="mono", rate=RATE)
    out = []
    with av.open(path) as c:
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                out.append(r.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.float32)


pcm = [load(p["file"]) for p in words_by_part]
os.makedirs(os.path.join(CACHE, "voice"), exist_ok=True)
TARGET_RMS = 10 ** (-20 / 20)  # about -20 dBFS while speaking
segments, out_lines, report = [], [], []
for li, l in enumerate(lines):
    sp = spans[li]
    if sp is None:
        report.append(f"{li:2d} MISSING  {l['text'][:70]}")
        out_lines.append({"seg": l["seg"], "text": l["text"], "file": None, "seconds": l["seconds"]})
        continue
    part = sp["part"]
    words = [t for t in trans if t[1] == part]
    s = trans[sp["j0"]][2] - 0.12
    e = trans[sp["j1"]][3] + 0.22
    # never into the neighbouring words of the same recording
    before = [t[3] for k, t in enumerate(trans) if t[1] == part and k < sp["j0"]]
    after = [t[2] for k, t in enumerate(trans) if t[1] == part and k > sp["j1"]]
    if before:
        s = max(s, before[-1] + 0.03)
    if after:
        e = min(e, after[0] - 0.03)
    s, e = max(0.0, s), min(len(pcm[part]) / RATE, e)
    a = pcm[part][int(s * RATE) : int(e * RATE)].copy()
    win = int(0.02 * RATE)
    env = np.sqrt(np.convolve(a**2, np.ones(win) / win, mode="same"))
    quiet = env < max(0.004, 0.08 * float(np.percentile(env, 95)))
    keep = np.ones(len(a), dtype=bool)
    k = 0
    while k < len(a):
        if quiet[k]:
            j = k
            while j < len(a) and quiet[j]:
                j += 1
            if (j - k) / RATE > 0.35 and k > 0 and j < len(a):  # inner pause: keep 0.25 s of it
                keep[k + int(0.125 * RATE) : j - int(0.125 * RATE)] = False
            k = j
        else:
            k += 1
    a = a[keep]
    loud = a[np.abs(a) > 0.02]
    rms = float(np.sqrt(np.mean(loud**2))) if len(loud) else float(np.sqrt(np.mean(a**2)) or 1e-4)
    a *= TARGET_RMS / max(rms, 1e-4)
    peak = float(np.max(np.abs(a))) or 1.0
    if peak > 0.89:
        a *= 0.89 / peak
    f = int(0.02 * RATE)
    a[:f] *= np.linspace(0, 1, f)
    a[-f:] *= np.linspace(1, 0, f)
    path = os.path.join(CACHE, "voice", f"line-{li:02d}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
    secs = len(a) / RATE
    heard = " ".join(t[0] for t in trans[sp["j0"] : sp["j1"] + 1])
    report.append(f"{li:2d} part{part + 1} {s:6.2f}-{e:6.2f} {secs:5.2f}s (plan {l['seconds']:5.2f}) {sp['matched']}/{sp['total']} | {heard[:80]}")
    out_lines.append({"seg": l["seg"], "text": l["text"], "file": path, "seconds": round(secs, 3)})

print("\n".join(report))
ids = []
for l in out_lines:
    if not ids or ids[-1] != l["seg"]:
        ids.append(l["seg"])
segs = [{"id": sid, "lines": [{"text": l["text"], "file": l["file"], "seconds": l["seconds"]} for l in out_lines if l["seg"] == sid]} for sid in ids]
json.dump({"voice": "recorded (your own voice)", "segments": segs}, open(os.path.join(CACHE, "timeline-audio.json"), "w", encoding="utf-8"), indent=1)
total = sum(l["seconds"] for l in out_lines)
print(f"wrote {len(out_lines)} lines, {total:.1f} s of speech -> cache/submission/timeline-audio.json")
