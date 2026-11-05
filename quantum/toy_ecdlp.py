"""Shor's algorithm for the elliptic-curve discrete log, at toy scale, on a real IBM quantum computer.

The same attack a large quantum computer would run against an Ethereum key: given the public key Q = k·G,
find the private key k. Here the group has 2^t points (t = 2 or 3 bits) instead of ~2^256, so a classical
computer solves it instantly too. The point is that the quantum algorithm works, on real hardware.

How the circuit is built (nothing in it depends on the answer k):
  * The points of <G> get labels by sorting their coordinates; the point at infinity is label 0.
  * "Add point P" is the permutation |label(X)> -> |label(X + P)>, computed from the curve's addition law.
  * Registers a and b (t qubits each) start in superposition; for each bit j, a[j] controls "add 2^j·G" and
    b[j] controls "add 2^j·Q" on the work register. The work register then holds (a + k·b)·G.
  * An inverse QFT on a and on b, then measure (c, d). Every outcome satisfies d = k·c (mod 2^t) in theory;
    with c odd, k = d·c^-1 (mod 2^t). The majority over all shots is the answer, checked by computing k·G.

Usage (from the repo root, with Python 3.12 + qiskit, qiskit-aer, qiskit-ibm-runtime):
  python quantum/toy_ecdlp.py plan  [--bits 2|3] [--key K]
  python quantum/toy_ecdlp.py sim   [--bits 2|3] [--key K] [--shots N]     ideal and noisy (FakeTorino) simulators
  python quantum/toy_ecdlp.py ibm   [--bits 2|3] [--key K] [--shots N] [--backend NAME]
  python quantum/toy_ecdlp.py fetch --job JOB_ID                          collect a finished IBM job
The IBM key is read from .env (IBM_QUANTUM_TOKEN, optional IBM_QUANTUM_INSTANCE) and never printed.
"""
import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, transpile
from qiskit.circuit.library import QFTGate, UnitaryGate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
EVIDENCE = os.path.join(ROOT, "evidence", "quantum")
INF = None  # the point at infinity


# ---------------------------------------------------------------- toy curve arithmetic
class Curve:
    def __init__(self, p, a, b):
        self.p, self.a, self.b = p, a, b

    def on(self, P):
        if P is INF:
            return True
        x, y = P
        return (y * y - (x * x * x + self.a * x + self.b)) % self.p == 0

    def add(self, P, Q):
        p = self.p
        if P is INF:
            return Q
        if Q is INF:
            return P
        (x1, y1), (x2, y2) = P, Q
        if x1 == x2 and (y1 + y2) % p == 0:
            return INF
        if P == Q:
            lam = (3 * x1 * x1 + self.a) * pow(2 * y1, -1, p) % p
        else:
            lam = (y2 - y1) * pow(x2 - x1, -1, p) % p
        x3 = (lam * lam - x1 - x2) % p
        return (x3, (lam * (x1 - x3) - y1) % p)

    def mul(self, k, P):
        R = INF
        for _ in range(k):
            R = self.add(R, P)
        return R

    def order(self, P):
        n, R = 1, P
        while R is not INF:
            R = self.add(R, P)
            n += 1
        return n

    def points(self):
        pts = [INF]
        for x in range(self.p):
            for y in range(self.p):
                if self.on((x, y)):
                    pts.append((x, y))
        return pts


def find_curve(bits):
    """Smallest prime field with a non-singular curve y^2 = x^3 + ax + b and a point of order exactly 2^bits."""
    r = 2**bits
    for p in [5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]:
        for a in range(p):
            for b in range(1, p):
                if (4 * a**3 + 27 * b * b) % p == 0:
                    continue
                E = Curve(p, a, b)
                for G in E.points()[1:]:
                    if E.order(G) == r:
                        return E, G
    raise SystemExit("no toy curve found")


# ---------------------------------------------------------------- circuit
def build(bits, key):
    r = 2**bits
    E, G = find_curve(bits)
    group = [E.mul(j, G) for j in range(r)]  # only used to list the subgroup's points
    labels = [INF] + sorted(P for P in group if P is not INF)  # coordinate order: independent of k
    lab = {P: i for i, P in enumerate(labels)}
    Q = E.mul(key, G)  # the public key

    def add_gate(P, name):
        perm = [lab[E.add(labels[i], P)] for i in range(r)]
        U = np.zeros((r, r))
        for i, j in enumerate(perm):
            U[j, i] = 1
        return UnitaryGate(U, label=name).control(1)

    a, b, w = QuantumRegister(bits, "a"), QuantumRegister(bits, "b"), QuantumRegister(bits, "w")
    c = ClassicalRegister(2 * bits, "c")
    qc = QuantumCircuit(a, b, w, c)
    qc.h(a)
    qc.h(b)
    for j in range(bits):
        qc.append(add_gate(E.mul(2**j, G), f"+{2**j}G"), [a[j], *w])
    for j in range(bits):
        qc.append(add_gate(E.mul(2**j, Q), f"+{2**j}Q"), [b[j], *w])
    qc.append(QFTGate(bits).inverse(), a)
    qc.append(QFTGate(bits).inverse(), b)
    qc.measure(a, c[:bits])
    qc.measure(b, c[bits:])
    info = {
        "curve": f"y^2 = x^3 + {E.a}x + {E.b} over F_{E.p}",
        "p": E.p,
        "a": E.a,
        "b": E.b,
        "G": list(G),
        "order": r,
        "publicKey": list(Q) if Q is not INF else "infinity",
        "labels": [("O" if P is INF else list(P)) for P in labels],
    }
    return qc, E, G, Q, info


def solve(counts, bits, E, G, Q):
    """Each shot (c, d) with c odd gives a candidate k = d·c^-1 mod 2^bits. Majority vote, then check k·G = Q."""
    r = 2**bits
    votes = Counter()
    on_lattice = {}
    total = sum(counts.values())
    for s, n in counts.items():
        s = s.replace(" ", "")
        cval, dval = int(s[bits:], 2), int(s[:bits], 2)
        if cval % 2:
            votes[dval * pow(cval, -1, r) % r] += n
    best = votes.most_common(1)[0][0] if votes else None
    for s, n in counts.items():
        s = s.replace(" ", "")
        cval, dval = int(s[bits:], 2), int(s[:bits], 2)
        on_lattice[s] = best is not None and dval == best * cval % r
    good = sum(n for s, n in counts.items() if on_lattice[s.replace(" ", "")])
    ok = best is not None and E.mul(best, G) == Q
    return {
        "recoveredKey": best,
        "verified": ok,
        "votes": {str(k): v for k, v in sorted(votes.items())},
        "voteShare": round(votes[best] / sum(votes.values()), 4) if votes else 0,
        "onLatticeShare": round(good / total, 4),
        "randomGuessShare": round(1 / r, 4),
    }


def two_qubit_count(tqc):
    ops = tqc.count_ops()
    return sum(v for k, v in ops.items() if k in ("cx", "cz", "ecr", "rzz"))


def save(name, payload):
    os.makedirs(EVIDENCE, exist_ok=True)
    path = os.path.join(EVIDENCE, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {os.path.relpath(path, ROOT)}")


TOKEN_NAMES = ("IBM_QUANTUM_TOKEN", "IBM_QUANTUM_API_KEY", "QISKIT_IBM_TOKEN", "IBM_API_KEY", "IBM_CLOUD_API_KEY")
INSTANCE_NAMES = ("IBM_QUANTUM_INSTANCE", "QISKIT_IBM_INSTANCE", "IBM_QUANTUM_CRN", "IBM_INSTANCE", "IBM_CRN")


def load_ibm_env():
    """Reads only the IBM Quantum variables from .env (a few common names), without printing them."""
    found = {}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                k = k.strip().removeprefix("export ").strip()
                if k in TOKEN_NAMES + INSTANCE_NAMES and v.strip():
                    found[k] = v.strip().strip('"').strip("'")
    for k in TOKEN_NAMES + INSTANCE_NAMES:
        if os.environ.get(k):
            found[k] = os.environ[k]
    token = next((found[k] for k in TOKEN_NAMES if k in found), None)
    instance = next((found[k] for k in INSTANCE_NAMES if k in found), None)
    if not token:
        raise SystemExit("No IBM Quantum API key in .env. Add a line: IBM_QUANTUM_TOKEN=<your API key>")
    print(f"IBM key found ({next(k for k in TOKEN_NAMES if k in found)}), instance {'set' if instance else 'not set (the service picks one)'}")
    return {"IBM_QUANTUM_TOKEN": token, "IBM_QUANTUM_INSTANCE": instance}


def service():
    from qiskit_ibm_runtime import QiskitRuntimeService

    env = load_ibm_env()
    return QiskitRuntimeService(channel="ibm_quantum_platform", token=env["IBM_QUANTUM_TOKEN"], instance=env.get("IBM_QUANTUM_INSTANCE") or None)


# ---------------------------------------------------------------- commands
def cmd_plan(args):
    qc, E, G, Q, info = build(args.bits, args.key)
    print(json.dumps(info, indent=2))
    print(f"secret key k = {args.key}  ->  public key Q = {info['publicKey']}")
    print(qc.draw(output="text", fold=140))


def cmd_sim(args):
    from qiskit_aer import AerSimulator
    from qiskit_aer.noise import NoiseModel
    from qiskit_ibm_runtime.fake_provider import FakeTorino

    qc, E, G, Q, info = build(args.bits, args.key)
    out = {"kind": "simulation", "bits": args.bits, "secretKey": args.key, **info, "runs": {}}
    ideal = AerSimulator()
    counts = ideal.run(transpile(qc, ideal), shots=args.shots).result().get_counts()
    out["runs"]["ideal"] = {"shots": args.shots, "counts": counts, **solve(counts, args.bits, E, G, Q)}
    fake = FakeTorino()
    tqc = transpile(qc, fake, optimization_level=3, seed_transpiler=7)
    noisy = AerSimulator.from_backend(fake)
    counts = noisy.run(tqc, shots=args.shots).result().get_counts()
    out["runs"]["noisy-FakeTorino"] = {
        "shots": args.shots,
        "twoQubitGates": two_qubit_count(tqc),
        "depth": tqc.depth(),
        "counts": counts,
        **solve(counts, args.bits, E, G, Q),
    }
    for name, r in out["runs"].items():
        extra = f", {r['twoQubitGates']} two-qubit gates, depth {r['depth']}" if "depth" in r else ""
        print(f"{name:18} key {r['recoveredKey']} verified={r['verified']}  vote share {r['voteShare']:.2f}  on-lattice {r['onLatticeShare']:.2f} (random {r['randomGuessShare']:.2f}){extra}")
    save(f"sim-{args.bits}bit.json", out)


def cmd_ibm(args):
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    from qiskit_ibm_runtime import SamplerV2

    qc, E, G, Q, info = build(args.bits, args.key)
    svc = service()
    backend = svc.backend(args.backend) if args.backend else svc.least_busy(operational=True, simulator=False, min_num_qubits=3 * args.bits)
    pm = generate_preset_pass_manager(optimization_level=3, backend=backend, seed_transpiler=7)
    tqc = pm.run(qc)
    print(f"backend {backend.name}: {tqc.num_qubits} physical qubits mapped, {two_qubit_count(tqc)} two-qubit gates, depth {tqc.depth()}")
    sampler = SamplerV2(mode=backend)
    sampler.options.default_shots = args.shots
    sampler.options.dynamical_decoupling.enable = True
    sampler.options.twirling.enable_gates = True
    job = sampler.run([tqc])
    meta = {"kind": "ibm-quantum", "bits": args.bits, "secretKey": args.key, **info, "backend": backend.name, "jobId": job.job_id(), "shots": args.shots, "twoQubitGates": two_qubit_count(tqc), "depth": tqc.depth(), "submittedAt": datetime.now(timezone.utc).isoformat()}
    save(f"ibm-{args.bits}bit-pending.json", meta)
    print(f"job {job.job_id()} submitted; waiting (Ctrl+C is safe: collect it later with `fetch --job {job.job_id()}`)")
    finish(job, meta, E, G, Q)


def finish(job, meta, E, G, Q):
    t0 = time.time()
    while True:
        st = str(job.status())
        if st in ("DONE", "ERROR", "CANCELLED", "JobStatus.DONE", "JobStatus.ERROR", "JobStatus.CANCELLED"):
            break
        print(f"  status {st} after {int(time.time() - t0)} s", flush=True)
        time.sleep(15)
    res = job.result()
    counts = res[0].data.c.get_counts()
    meta["counts"] = counts
    meta.update(solve(counts, meta["bits"], E, G, Q))
    try:
        meta["quantumSeconds"] = job.metrics().get("usage", {}).get("quantum_seconds")
    except Exception:
        pass
    meta["finishedAt"] = datetime.now(timezone.utc).isoformat()
    print(f"recovered key {meta['recoveredKey']} (secret was {meta['secretKey']}), verified={meta['verified']}, vote share {meta['voteShare']:.2f}, on-lattice {meta['onLatticeShare']:.2f} (random {meta['randomGuessShare']:.2f}), QPU {meta.get('quantumSeconds')} s")
    save(f"ibm-{meta['bits']}bit-{meta['backend']}-{meta['jobId']}.json", meta)
    pending = os.path.join(EVIDENCE, f"ibm-{meta['bits']}bit-pending.json")
    if os.path.exists(pending):
        os.remove(pending)


def cmd_fetch(args):
    svc = service()
    job = svc.job(args.job)
    pending = os.path.join(EVIDENCE, f"ibm-{args.bits}bit-pending.json")
    meta = json.load(open(pending, encoding="utf-8")) if os.path.exists(pending) else {"kind": "ibm-quantum", "bits": args.bits, "secretKey": args.key, "jobId": args.job, "backend": job.backend().name}
    _, E, G, Q, info = build(meta["bits"], meta["secretKey"])
    meta.update({k: v for k, v in info.items() if k not in meta})
    finish(job, meta, E, G, Q)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["plan", "sim", "ibm", "fetch"])
    ap.add_argument("--bits", type=int, default=2, choices=[2, 3])
    ap.add_argument("--key", type=int, default=None, help="the secret key k (default: 3 for 2 bits, 5 for 3 bits)")
    ap.add_argument("--shots", type=int, default=4000)
    ap.add_argument("--backend", default=None)
    ap.add_argument("--job", default=None)
    args = ap.parse_args()
    if args.key is None:
        args.key = 3 if args.bits == 2 else 5
    if not 0 < args.key < 2**args.bits:
        sys.exit("--key must be between 1 and 2^bits - 1")
    {"plan": cmd_plan, "sim": cmd_sim, "ibm": cmd_ibm, "fetch": cmd_fetch}[args.cmd](args)
