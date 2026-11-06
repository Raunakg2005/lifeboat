"""The submission video: the silent screen recording + YOUR voice-over (+ an optional quiet music bed).

ETHGlobal's rules: a real voice (no text-to-speech), 2-4 minutes, at least 720p, no speed-up. This copies the
video stream as it is (no re-encode, no speed change), lines your voice up with the script, and mixes the music
well under it, dipping further while you speak.

Usage: python final.py <silent.mp4> <voice file> <out.mp4> [--music bed.wav | --no-music] [--offset SECONDS] [--first-line SECONDS]
  --offset      where the voice starts in the video (default: found automatically, so your first word lands on
                the first line's cue)
  --first-line  the first line's cue time in the video (from the teleprompter's timeline; default 2.5)
"""
import argparse
import os
from fractions import Fraction

import av
import numpy as np
from av.audio.resampler import AudioResampler

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("voice")
ap.add_argument("out")
ap.add_argument("--music", default=None)
ap.add_argument("--no-music", action="store_true")
ap.add_argument("--offset", type=float, default=None)
ap.add_argument("--first-line", type=float, default=2.5)
args = ap.parse_args()
RATE = 48000


def load(path, layout):
    res = AudioResampler(format="flt", layout=layout, rate=RATE)
    chunks = []
    with av.open(path) as c:
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                chunks.append(r.to_ndarray())
    for r in res.resample(None):
        chunks.append(r.to_ndarray())
    a = np.concatenate(chunks, axis=1) if chunks else np.zeros((1 if layout == "mono" else 2, 0), np.float32)
    return a.reshape(-1) if layout == "mono" else a.reshape(2, -1, order="F") if a.shape[0] == 1 else a


with av.open(args.video) as c:
    vs = c.streams.video[0]
    duration = float(c.duration / 1e6) if c.duration else float(vs.duration * vs.time_base)
    width, height = vs.codec_context.width, vs.codec_context.height
print(f"video: {width}x{height}, {duration:.1f} s")
problems = []
if height < 720:
    problems.append(f"height {height} < 720")
if not 120 <= duration <= 240:
    problems.append(f"length {duration:.1f} s is outside 2-4 minutes")

voice = load(args.voice, "mono")
# 80 Hz high-pass (rumble), then level: about -18 dBFS RMS on the speech, peaks under -1 dBFS
alpha = np.exp(-2 * np.pi * 80 / RATE)
try:
    from scipy.signal import lfilter

    voice = lfilter([alpha, -alpha], [1, -alpha], voice).astype(np.float32)
except ImportError:  # no scipy: subtract a short moving average instead (removes DC and the lowest rumble)
    k = RATE // 80
    c = np.cumsum(np.insert(voice.astype(np.float64), 0, 0))
    ma = (c[k:] - c[:-k]) / k
    voice = (voice - np.pad(ma, (k // 2, len(voice) - len(ma) - k // 2), mode="edge")).astype(np.float32)
win = RATE // 20
frames = len(voice) // win
rms = np.sqrt(np.mean(voice[: frames * win].reshape(frames, win) ** 2, axis=1)) if frames else np.zeros(1)
speech = rms > max(0.01, np.percentile(rms, 60) * 0.5)
speech_rms = float(np.sqrt(np.mean(rms[speech] ** 2))) if speech.any() else float(rms.max() or 1)
voice *= 10 ** (-18 / 20) / max(speech_rms, 1e-6)
peak = float(np.max(np.abs(voice))) or 1.0
if peak > 0.89:
    voice *= 0.89 / peak

onset = (int(np.argmax(speech)) * win / RATE) if speech.any() else 0.0
offset = args.offset if args.offset is not None else args.first_line - onset
print(f"voice: {len(voice) / RATE:.1f} s, first word at {onset:.2f} s in the recording -> placed at {onset + offset:.2f} s (offset {offset:+.2f} s)")

total = int(duration * RATE)
mix = np.zeros((2, total), np.float32)
start = int(round(offset * RATE))
src0 = max(0, -start)
dst0 = max(0, start)
m = min(len(voice) - src0, total - dst0)
if m > 0:
    mix[0, dst0 : dst0 + m] += voice[src0 : src0 + m]
    mix[1, dst0 : dst0 + m] += voice[src0 : src0 + m]
voice_track = mix[0].copy()

music_path = None if args.no_music else (args.music or os.path.join(os.path.dirname(args.out), "music-bed.wav"))
if music_path and os.path.exists(music_path):
    music = load(music_path, "stereo")
    if music.ndim == 1:
        music = np.stack([music, music])
    reps = int(np.ceil(total / max(1, music.shape[1])))
    music = np.tile(music, (1, reps))[:, :total]
    # ducking: an envelope of the voice (fast attack, slow release) pulls the music down while you talk
    env = np.abs(voice_track)
    hop = RATE // 100
    blocks = np.maximum.reduceat(env, np.arange(0, total, hop)) if total else env
    active = (blocks > 0.02).astype(np.float32)
    smooth = np.empty_like(active)
    acc = 0.0
    for i, a in enumerate(active):
        acc += (0.5 if a > acc else 0.04) * (a - acc)
        smooth[i] = acc
    gain = np.repeat(smooth, hop)[:total]
    level = 10 ** (-26 / 20) / 10 ** (-20 / 20)  # the bed is mastered at -20 dBFS: sit it at about -26
    music *= level * (1 - 0.6 * gain)
    fade = RATE * 2
    music[:, -fade:] *= np.linspace(1, 0, fade)
    mix += music.astype(np.float32)
    print(f"music: {os.path.basename(music_path)}, about -26 dBFS, dipping ~8 dB under the voice")
else:
    print("music: none")

peak = float(np.max(np.abs(mix))) or 1.0
if peak > 0.97:
    mix *= 0.97 / peak

# remux: copy the video packets untouched, encode the new audio
with av.open(args.video) as src, av.open(args.out, "w", options={"movflags": "+faststart"}) as out:
    vin = src.streams.video[0]
    vout = out.add_stream_from_template(vin)
    aout = out.add_stream("aac", rate=RATE, layout="stereo")
    aout.bit_rate = 160_000
    for pkt in src.demux(vin):
        if pkt.dts is None:
            continue
        pkt.stream = vout
        out.mux(pkt)
    CH = 1024
    for i in range(0, total, CH):
        fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(mix[:, i : i + CH]), format="fltp", layout="stereo")
        fr.sample_rate = RATE
        fr.pts = i
        fr.time_base = Fraction(1, RATE)
        for p in aout.encode(fr):
            out.mux(p)
    for p in aout.encode():
        out.mux(p)
print(f"wrote {args.out} ({os.path.getsize(args.out) / 1e6:.1f} MB)")
print("CHECK BEFORE UPLOAD: " + ("; ".join(problems) if problems else "720p+, 2-4 minutes, real voice, original speed: OK"))
