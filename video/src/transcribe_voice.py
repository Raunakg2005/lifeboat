"""Transcribes the voice-over recordings offline (faster-whisper, word timings) for alignment and subtitles.
Usage: python transcribe_voice.py <out.json> <part1> [part2 ...]   (the files are decoded with PyAV, 16 kHz mono)"""
import json
import os
import sys

import av
import numpy as np
from av.audio.resampler import AudioResampler
from faster_whisper import WhisperModel


def load(path):
    res = AudioResampler(format="flt", layout="mono", rate=16000)
    pcm = []
    with av.open(path) as c:
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                pcm.append(r.to_ndarray().reshape(-1))
    for r in res.resample(None):
        pcm.append(r.to_ndarray().reshape(-1))
    return np.concatenate(pcm).astype(np.float32)


out, parts = sys.argv[1], sys.argv[2:]
# reuse the words of a recording that hasn't changed since the last run (same path, size and time)
previous = {}
if os.path.exists(out):
    for e in json.load(open(out, encoding="utf-8")):
        if "stamp" in e:
            previous[e["file"]] = e
stamp = lambda p: f"{os.path.getsize(p)}:{int(os.path.getmtime(p))}"
model = None
result = []
for p in parts:
    if p in previous and previous[p]["stamp"] == stamp(p):
        result.append(previous[p])
        print(f"{p}: unchanged, {len(previous[p]['words'])} words reused", flush=True)
        continue
    model = model or WhisperModel("medium", device="cpu", compute_type="int8")
    audio = load(p)
    segs, info = model.transcribe(audio, language="en", word_timestamps=True, vad_filter=True, beam_size=5,
                                  initial_prompt="Lifeboat, Q-Day, Ethereum, ENS v2, Safe, EIP-8141, Arkiv, Swarm, ESP32, post-quantum, lifeboathw.eth, lifeboatpq.eth")
    words = []
    for s in segs:
        for w in s.words:
            words.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)})
    result.append({"file": p, "stamp": stamp(p), "duration": len(audio) / 16000, "words": words})
    print(f"{p}: {len(words)} words: {' '.join(x['w'] for x in words)[:300]}", flush=True)
json.dump(result, open(out, "w", encoding="utf-8"), indent=1)
print("wrote", out)
