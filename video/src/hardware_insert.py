"""Puts the real ESP32 footage into the silent cut, over the "Sign safely" beat, at real speed (no speed-up).

The segment, in the app's harbour style:
  - the phone clip (muted) in a luggage-tag frame
  - the ESP32's own screen, tracked (its cyan text) and enlarged, so the request is readable
  - five steps that light up in time: request, shown in words, BOOT, counter saved + signed, on Sepolia
  - a footer with the real transaction
Timing comes from cache/submission/timeline.json, so the length of the video doesn't change.
With --subs (the voiced cut): also burns in subtitles (the script's wording, chunked to at most two lines and timed
within each spoken line), writes <out>.srt, and mixes the recorded voice lines back in.
Usage: python hardware_insert.py <in.mp4> <clip.mp4> <out.mp4> <timeline.json> [beat id, default "hardware"] [--subs]
"""
import json
import sys
from fractions import Fraction

import av
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SILENT, CLIP, OUT, TIMELINE = sys.argv[1:5]
BEAT = sys.argv[5] if len(sys.argv) > 5 and not sys.argv[5].startswith("--") else "hardware"
SUBS = "--subs" in sys.argv
RATE = 48000
W, H, FPS = 1280, 720, 30

PAPER, CARD, INK, INK_SOFT, INK_FAINT = "#f2eee6", "#ffffff", "#0b1f33", "#4a5a6c", "#8792a0"
ORANGE, GREEN = "#f05a1a", "#1d8a5b"
F = "C:/Windows/Fonts/"
font = lambda name, size: ImageFont.truetype(F + name, size)
H1, LOGO = font("ariblk.ttf", 30), font("ariblk.ttf", 24)
B19, B17 = font("arialbd.ttf", 19), font("arialbd.ttf", 17)
M15, M13, MB14, MB15 = font("consola.ttf", 15), font("consola.ttf", 13), font("consolab.ttf", 14), font("consolab.ttf", 15)

STEPS = [  # (clip seconds it starts at, title, detail)
    (0.0, "The laptop sends the request itself", "the device never signs a bare hash"),
    (2.0, "The ESP32 shows it in words", "PQ WALLET · setText · lifeboathw.eth"),
    (5.6, "BOOT on each page, then BOOT=SIGN", "a press on the device, nothing remote"),
    (7.6, "Counter saved first, then signed", "leaf 6 burned · next leaf 7"),
    (14.0, "On Sepolia", "block 12,076,694 · our wallet only relayed it"),
]
FOOT1 = "Our test name lifeboathw.eth belongs to a post-quantum wallet whose key exists only on this ESP32."
FOOT2 = "tx 0x285640a1…c523 · Sepolia block 12,076,694 · leaf 6 · filmed live, real speed"

tl = json.load(open(TIMELINE, encoding="utf-8"))
chapters = [c["t"] for c in tl["chapters"]]
lines = [l for l in tl["lines"] if l["seg"] == BEAT]
seg_i = next(i for i, c in enumerate(tl["chapters"]) if abs(c["t"] - (lines[0]["t"] - 0.5)) < 1.0)
WIN0 = tl["chapters"][seg_i]["t"]
WIN1 = tl["chapters"][seg_i + 1]["t"] if seg_i + 1 < len(chapters) else tl["duration"]
CLIP0 = lines[0]["t"]  # the clip starts with the beat's first spoken line
FADE = 0.35
print(f"segment {WIN0:.2f}-{WIN1:.2f} s, clip from {CLIP0:.2f} s")


def wrap(d, text, fnt, width):
    words, out, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=fnt) <= width:
            cur = t
        else:
            out.append(cur)
            cur = w
    return out + ([cur] if cur else [])


def static_layer():
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 60], fill=INK)
    d.text((32, 15), "LIFEBOAT", font=LOGO, fill="#ffffff")
    d.text((200, 22), "HARDWARE SIGNER · ESP32 · CLEAR SIGNING", font=MB15, fill="#b8c4d2")
    tag = "LIVE ON SEPOLIA"
    tw = d.textlength(tag, font=MB14)
    d.rectangle([W - 32 - tw - 20, 16, W - 32, 44], fill=ORANGE)
    d.text((W - 32 - tw - 10, 21), tag, font=MB14, fill=INK)
    # luggage-tag frame for the clip: orange offset shadow, navy border
    d.rectangle([32 + 8, 84 + 8, 32 + 816 + 8, 84 + 459 + 8], fill=ORANGE)
    d.rectangle([28, 80, 32 + 816 + 4, 84 + 459 + 4], fill=INK)
    # footer card
    d.rectangle([32 + 6, 566 + 6, 848 + 6, 694 + 6], fill=INK)
    d.rectangle([32, 566, 848, 694], fill=CARD, outline=INK, width=3)
    y = 582
    for ln in wrap(d, FOOT1, B19, 780):
        d.text((50, y), ln, font=B19, fill=INK)
        y += 26
    d.text((50, y + 8), FOOT2, font=M13, fill=INK_SOFT)
    # inset frame
    d.text((880, 82), "ON ITS SCREEN (ENLARGED)", font=M13, fill=INK_SOFT)
    d.rectangle([876, 100, 880 + 368 + 4, 104 + 260 + 4], fill=INK)
    return img


BASE = static_layer()


def steps_layer(img, ct):
    d = ImageDraw.Draw(img)
    active = max(i for i, s in enumerate(STEPS) if ct >= s[0])
    y = 386
    for i, (_, title, detail) in enumerate(STEPS):
        box = [880, y, 914, y + 34]
        if i < active:
            d.rectangle(box, fill=INK)
            d.text((890, y + 6), "✓" if False else str(i + 1), font=MB15, fill="#ffffff")
            tcol, dcol = INK, INK_SOFT
        elif i == active:
            d.rectangle([box[0] - 4, y - 4, 1248, y + 52], fill="#fde3d6")
            d.rectangle(box, fill=ORANGE)
            d.text((891, y + 6), str(i + 1), font=MB15, fill=INK)
            tcol, dcol = INK, INK
        else:
            d.rectangle(box, outline=INK_FAINT, width=2)
            d.text((891, y + 6), str(i + 1), font=MB15, fill=INK_FAINT)
            tcol, dcol = INK_FAINT, INK_FAINT
        d.text((926, y + 1), title, font=B17 if len(title) < 34 else font("arialbd.ttf", 15), fill=tcol)
        d.text((926, y + 24), detail, font=M13, fill=dcol)
        y += 60


def track(rgb, prev):
    a = rgb.astype(np.int16)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    m = (B > 170) & (G > 140) & (B > R + 35)
    ys, xs = np.nonzero(m)
    if len(xs) < 150:
        return prev
    x0, x1 = np.percentile(xs, [3, 97])
    y0, y1 = np.percentile(ys, [3, 97])
    c = ((x0 + x1) / 2, (y0 + y1) / 2)
    return c if prev is None else (prev[0] * 0.75 + c[0] * 0.25, prev[1] * 0.75 + c[1] * 0.25)


def compose(clip_rgb, center, ct):
    img = BASE.copy()
    clip = Image.fromarray(clip_rgb)
    img.paste(clip.resize((816, 459), Image.LANCZOS), (32, 84))
    cw, ch = 170, 120
    cx = min(max(center[0], cw / 2), clip.width - cw / 2)
    cy = min(max(center[1], ch / 2), clip.height - ch / 2)
    crop = clip.crop((int(cx - cw / 2), int(cy - ch / 2), int(cx + cw / 2), int(cy + ch / 2)))
    img.paste(crop.resize((368, 260), Image.LANCZOS), (880, 104))
    steps_layer(img, ct)
    return np.asarray(img)


# ---------- subtitles: each spoken line in chunks of at most two lines, timed by its words ----------
SUB_FONT = font("arialbd.ttf", 27)
_m = ImageDraw.Draw(Image.new("RGB", (10, 10)))


def chunks(text, width=980, max_lines=2):
    out, cur = [], []
    for w in text.split():
        trial = cur + [w]
        if len(wrap(_m, " ".join(trial), SUB_FONT, width)) > max_lines:
            out.append(" ".join(cur))
            cur = [w]
        else:
            cur = trial
    return out + ([" ".join(cur)] if cur else [])


CUES = []  # (start, end, text)
if SUBS:
    for l in tl["lines"]:
        parts = chunks(l["text"])
        total = sum(len(p.split()) for p in parts)
        t = l["t"]
        for p in parts:
            d = l["seconds"] * len(p.split()) / total
            CUES.append((t, t + d + (0.25 if p is parts[-1] else 0.0), p))
            t += d
    CUES = [(a, min(b, CUES[k + 1][0] - 0.02) if k + 1 < len(CUES) else b, x) for k, (a, b, x) in enumerate(CUES)]  # no overlaps


def draw_sub(img, t, in_window):
    cue = next((c for c in CUES if c[0] <= t < c[1]), None)
    if not cue:
        return img
    lines_ = wrap(_m, cue[2], SUB_FONT, 980 if not in_window else 760)  # over the device clip: the clip panel's width
    lh = 36
    bw = max(_m.textlength(x, font=SUB_FONT) for x in lines_) + 48
    bh = lh * len(lines_) + 22
    x0 = (W - bw) / 2 if not in_window else 32 + (816 - bw) / 2
    y1 = H - 26 if not in_window else 84 + 459 - 14
    y0 = y1 - bh
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([x0, y0, x0 + bw, y1], fill=(11, 31, 51, 222))
    d.rectangle([x0, y0, x0 + 6, y1], fill=(240, 90, 26, 255))
    for k, ln in enumerate(lines_):
        tw = d.textlength(ln, font=SUB_FONT)
        d.text((x0 + (bw - tw) / 2 + 3, y0 + 11 + k * lh), ln, font=SUB_FONT, fill=(255, 255, 255, 255))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def srt(path):
    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
    with open(path, "w", encoding="utf-8") as f:
        for i, (a, b, text) in enumerate(CUES, 1):
            f.write("\n".join([str(i), f"{ts(a)} --> {ts(b)}", text, "", ""]))


def clip_frames():
    with av.open(CLIP) as c:
        for f in c.decode(c.streams.video[0]):
            yield float(f.time), f.to_ndarray(format="rgb24")


out = av.open(OUT, "w", options={"movflags": "+faststart"})
vs = out.add_stream("libx264", rate=FPS, options={"crf": "20", "preset": "medium", "g": "150"})
vs.width, vs.height, vs.pix_fmt = W, H, "yuv420p"
vs.codec_context.time_base = Fraction(1, FPS)
VOICE_LINES = [l for l in tl["lines"] if l.get("file")]
as_ = out.add_stream("aac", rate=RATE, layout="mono") if VOICE_LINES else None
if as_:
    as_.bit_rate = 160_000

cf = clip_frames()
cur_t, cur = next(cf)
nxt = next(cf, None)
center = None
n = 0
with av.open(SILENT) as src:
    for f in src.decode(src.streams.video[0]):
        t = n / FPS
        rgb = f.to_ndarray(format="rgb24")
        if WIN0 <= t < WIN1:
            ct = max(0.0, t - CLIP0)
            while nxt is not None and nxt[0] <= ct:
                cur_t, cur = nxt
                nxt = next(cf, None)
            center = track(cur, center)
            seg = compose(cur, center or (427, 240), ct)
            k = min(1.0, (t - WIN0) / FADE, (WIN1 - t) / FADE)
            rgb = seg if k >= 1 else (seg * k + rgb * (1 - k)).astype(np.uint8)
        if SUBS:
            rgb = np.asarray(draw_sub(Image.fromarray(rgb), t, WIN0 + FADE <= t < WIN1 - FADE))
        vf = av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb), format="rgb24").reformat(width=W, height=H, format="yuv420p", dst_colorspace="ITU709", dst_color_range="MPEG")
        vf.pts = n
        vf.time_base = Fraction(1, FPS)
        for p in vs.encode(vf):
            out.mux(p)
        n += 1
        if n % (FPS * 30) == 0:
            print(f"  {t:6.1f} s", flush=True)
for p in vs.encode():
    out.mux(p)

# the recorded voice, every line at its place on the timeline (as compose.py places it)
if as_:
    from av.audio.resampler import AudioResampler
    buf = np.zeros(int((n / FPS + 1) * RATE), dtype=np.float32)
    for l in VOICE_LINES:
        res = AudioResampler(format="flt", layout="mono", rate=RATE)
        pcm = []
        with av.open(l["file"]) as c:
            for fr in c.decode(audio=0):
                for r in res.resample(fr):
                    pcm.append(r.to_ndarray().reshape(-1))
        a = np.concatenate(pcm)
        i0 = int(l["t"] * RATE)
        buf[i0 : i0 + len(a)] += a[: max(0, len(buf) - i0)]
    peak = float(np.max(np.abs(buf))) or 1.0
    buf *= min(1.0, 0.89 / peak)
    samples = buf[: int(n / FPS * RATE)]
    for i in range(0, len(samples), 1024):
        af = av.AudioFrame.from_ndarray(samples[i : i + 1024].reshape(1, -1), format="fltp", layout="mono")
        af.sample_rate = RATE
        af.pts = i
        af.time_base = Fraction(1, RATE)
        for p in as_.encode(af):
            out.mux(p)
    for p in as_.encode():
        out.mux(p)
out.close()
if SUBS:
    srt(OUT[:-4] + ".srt")
    print(f"subtitles: {len(CUES)} cues burned in, {OUT[:-4]}.srt written")
print(f"wrote {OUT}: {n} frames, {n / FPS:.1f} s")
