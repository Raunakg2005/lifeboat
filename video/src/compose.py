"""Builds the MP4: frames at 30 fps (H.264) + the narration lines placed on their timeline (AAC).
Also writes subtitles (.srt) and a chapter list. Run through compose.mjs, which finds a Python with PyAV.
Usage: python compose.py <cache dir> <out dir>
"""
import json
import os
import sys
from fractions import Fraction

import av
import numpy as np
from av.audio.resampler import AudioResampler

CACHE, OUT = sys.argv[1], sys.argv[2]
NAME = sys.argv[3] if len(sys.argv) > 3 else "lifeboat-walkthrough"
FPS = 30
RATE = 48000

tl = json.load(open(os.path.join(CACHE, "timeline.json"), encoding="utf-8"))
frames = json.load(open(os.path.join(CACHE, "frames.json"), encoding="utf-8"))
W, H, dur = tl["width"], tl["height"], tl["duration"]
os.makedirs(OUT, exist_ok=True)
mp4 = os.path.join(OUT, f"{NAME}.mp4")
SILENT = bool(tl.get("silent"))  # the real-voice cut: video only, the voice is added by final.py

# ---------- audio: one buffer, every line at its start time ----------
buf = np.zeros(int((dur + 1) * RATE), dtype=np.float32)
for line in [] if SILENT else tl["lines"]:
    res = AudioResampler(format="flt", layout="mono", rate=RATE)
    pcm = []
    with av.open(line["file"]) as c:
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                pcm.append(r.to_ndarray().reshape(-1))
    for r in res.resample(None):
        pcm.append(r.to_ndarray().reshape(-1))
    a = np.concatenate(pcm) if pcm else np.zeros(0, dtype=np.float32)
    i = int(line["t"] * RATE)
    buf[i : i + len(a)] += a[: max(0, len(buf) - i)]
peak = float(np.max(np.abs(buf))) or 1.0
buf *= min(1.0, 0.89 / peak)

out = av.open(mp4, "w", options={"movflags": "+faststart"})
vs = out.add_stream("libx264", rate=FPS, options={"crf": "20", "preset": "medium", "tune": "animation", "g": "150"})
vs.width, vs.height, vs.pix_fmt = W, H, "yuv420p"
vs.codec_context.time_base = Fraction(1, FPS)
as_ = None if SILENT else out.add_stream("aac", rate=RATE, layout="mono")
if as_:
    as_.bit_rate = 128_000

# ---------- video: latest captured frame at each 1/30 s tick ----------
total = int(dur * FPS)
k = 0
cur = None
cur_file = None
for n in range(total):
    t = n / FPS
    while k + 1 < len(frames) and frames[k + 1]["t"] <= t:
        k += 1
    f = frames[k]["file"]
    if f != cur_file:
        with av.open(os.path.join(CACHE, "frames", f)) as c:
            img = next(c.decode(video=0))
        # rebuild from RGB pixels: frames decoded from JPEG are flagged as keyframes (x264 would honour that)
        # and are full-range YUV; going through RGB gives correct limited-range colours
        rgb = img.to_ndarray(format="rgb24")
        cur = av.VideoFrame.from_ndarray(rgb, format="rgb24").reformat(width=W, height=H, format="yuv420p", dst_colorspace="ITU709", dst_color_range="MPEG")
        cur_file = f
    vf = cur
    vf.pts = n
    vf.time_base = Fraction(1, FPS)
    for p in vs.encode(vf):
        out.mux(p)
    if n % (FPS * 30) == 0:
        print(f"  video {t:6.1f} / {dur:.1f} s", flush=True)
for p in vs.encode():
    out.mux(p)

CH = 1024
samples = buf[: int(dur * RATE)] if as_ else buf[:0]
for i in range(0, len(samples), CH):
    chunk = samples[i : i + CH]
    af = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="fltp", layout="mono")
    af.sample_rate = RATE
    af.pts = i
    af.time_base = Fraction(1, RATE)
    for p in as_.encode(af):
        out.mux(p)
if as_:
    for p in as_.encode():
        out.mux(p)
out.close()


# ---------- subtitles + chapters ----------
def ts(s, sep=","):
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{sec:02}{sep}{ms:03}"


with open(os.path.join(OUT, f"{NAME}.srt"), "w", encoding="utf-8") as f:
    for i, line in enumerate(tl["lines"], 1):
        f.write(f"{i}\n{ts(line['t'])} --> {ts(line['t'] + line['seconds'])}\n{line['text']}\n\n")
with open(os.path.join(OUT, f"{NAME}-chapters.txt" if SILENT else "chapters.txt"), "w", encoding="utf-8") as f:
    for c in tl["chapters"]:
        m, s = divmod(int(max(0, c["t"])), 60)
        f.write(f"{m}:{s:02} {c['title']}\n")
print(f"wrote {mp4} ({os.path.getsize(mp4) / 1e6:.1f} MB, {dur:.1f} s)")
