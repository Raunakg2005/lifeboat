"""A quiet music bed for the voice-over, synthesized here (no samples, no licences to worry about).

Slow pad chords (A minor, F, C, G) with soft attack and release, a sub-bass root, a sparse plucked arpeggio and
filtered-noise "sea swells" every few bars, mastered to about -20 dBFS so it sits under a voice.
Usage: python music.py <out.wav> [seconds]
"""
import sys
import wave

import numpy as np

OUT = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 240.0
SR = 48000
BPM = 72
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(8141)

n = int(SECONDS * SR)
t = np.arange(n) / SR
left = np.zeros(n, dtype=np.float64)
right = np.zeros(n, dtype=np.float64)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# A minor, F major, C major, G major (two bars each)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]


def env(length, attack, release):
    e = np.ones(length)
    a = int(attack * SR)
    r = int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a) ** 2
    if r:
        e[-r:] *= np.linspace(1, 0, r) ** 2
    return e


def add(sig, start, l_gain, r_gain):
    s = int(start * SR)
    if s >= n:
        return
    e = min(n, s + len(sig))
    left[s:e] += sig[: e - s] * l_gain
    right[s:e] += sig[: e - s] * r_gain


chord_len = 2 * BAR
k = 0
while k * chord_len < SECONDS:
    chord = CHORDS[k % len(CHORDS)]
    start = k * chord_len
    L = int((chord_len + 1.5) * SR)
    tt = np.arange(L) / SR
    e = env(L, 1.8, 2.5)
    for i, m in enumerate(chord):
        f = midi(m)
        # two slightly detuned voices per note, a little triangle for warmth
        voice = np.sin(2 * np.pi * f * tt) + 0.6 * np.sin(2 * np.pi * f * 1.003 * tt + 1.1)
        voice += 0.25 * (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * 0.5 * tt))
        add(voice * e * 0.055, start, 0.9 - 0.2 * i, 0.5 + 0.2 * i)
    # sub-bass root
    root = midi(chord[0] - 12)
    add(np.sin(2 * np.pi * root * tt) * e * 0.07, start, 0.7, 0.7)
    # sparse plucked arpeggio on the off-beats of the second bar
    for j, step in enumerate([0, 2, 1, 2]):
        p_start = start + BAR + (j + 0.5) * BEAT
        pl = int(1.6 * BEAT * SR)
        pt = np.arange(pl) / SR
        pluck = np.sin(2 * np.pi * midi(chord[step] + 12) * pt) * np.exp(-pt * 4.5)
        add(pluck * 0.035, p_start, 0.4 + 0.15 * j, 0.8 - 0.15 * j)
    k += 1

# sea swells: low-passed noise with a slow rise and fall, every 3 bars
swell_every = 3 * BAR
s0 = 1.5
while s0 < SECONDS:
    L = int(5.0 * SR)
    noise = rng.standard_normal(L)
    # one-pole low-pass, twice
    for _ in range(2):
        y = np.empty(L)
        acc = 0.0
        a = 0.02
        for i in range(L):
            acc += a * (noise[i] - acc)
            y[i] = acc
        noise = y
    shape = np.sin(np.linspace(0, np.pi, L)) ** 3
    add(noise * shape * 0.35, s0, 0.6, 0.9)
    s0 += swell_every

# fade in/out, normalise to about -20 dBFS RMS with a safe peak
fade = int(3.0 * SR)
for ch in (left, right):
    ch[:fade] *= np.linspace(0, 1, fade)
    ch[-fade:] *= np.linspace(1, 0, fade)
mix = np.stack([left, right], axis=1)
rms = np.sqrt(np.mean(mix**2)) or 1.0
mix *= 10 ** (-20 / 20) / rms
peak = np.max(np.abs(mix))
if peak > 0.9:
    mix *= 0.9 / peak
pcm = (mix * 32767).astype("<i2")
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {OUT}: {SECONDS:.0f} s, stereo {SR} Hz, about -20 dBFS")
