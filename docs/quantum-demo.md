# Public key → private key: Shor's algorithm at toy scale

**Why this is in Lifeboat:** the whole project rests on one claim: once a public key is on-chain, a large enough quantum computer can compute the private key. This demo runs that exact attack, Shor's algorithm for the elliptic-curve discrete log, on toy curves small enough for today's machines, first on simulators and then on a real IBM quantum computer.

No quantum computer can do this to a real Ethereum key today. These keys have 2 and 3 bits; Ethereum's have 256.

Code: [`quantum/toy_ecdlp.py`](../quantum/toy_ecdlp.py) · results: [`evidence/quantum/`](../evidence/quantum/) · shown in the app's Discover tab.

## The toy curves

| Key size | Curve | Generator G | Points in ⟨G⟩ | Secret k | Public key Q = k·G |
|---|---|---|---|---|---|
| 2 bits | y² = x³ + x + 2 over F₅ | (1, 2) | 4 | 3 | (1, 3) |
| 3 bits | y² = x³ + 4x + 1 over F₅ | (0, 1) | 8 | 5 | (1, 1) |

The script finds the smallest curve with a point of order exactly 2^t.

## The circuit

1. **Labels.** The points of ⟨G⟩ get labels by sorting their coordinates; the point at infinity is label 0. The labels don't depend on k.
2. **"Add a point" gates.** Adding a fixed point P is a permutation of the labels, `|label(X)⟩ → |label(X + P)⟩`, computed with the curve's addition law. Each one is controlled by a single qubit.
3. **Registers:**
   - `a` and `b`: t qubits each, put in superposition with Hadamards;
   - `w`: t qubits, starts at the point at infinity.
4. **The work.** For each bit j:
   - `a[j]` controls "add 2^j·G";
   - `b[j]` controls "add 2^j·Q".

   The work register then holds (a + k·b)·G.
5. **Readout.** An inverse QFT on `a` and on `b`, then measure both, giving (c, d).

**Reading the answer:**
- Every outcome satisfies d ≡ k·c (mod 2^t).
- When c is odd, k = d · c⁻¹ (mod 2^t).
- Each shot votes. The candidate with the most votes is the answer, and the script checks it by computing k·G and comparing with Q.

**Honesty notes:**
- **Why we'd know it worked by chance.** "On the answer's pattern" is the share of shots with d ≡ k·c. It's 100% in an ideal run and 1/2^t for pure noise, so the gap measures how much real signal survived.
- **Why this only works at toy scale.** The "add a point" gates are compiled from the toy curve's addition table. That's possible only because the curve has 4 or 8 points. A real attack builds point addition from quantum arithmetic. Google Quantum AI's March 2026 estimate for a 256-bit curve is about 1,200 error-corrected logical qubits.
- **A classical computer** solves these toy keys instantly. The point is that the quantum algorithm recovers them.

## Results

### Simulators (Qiskit Aer, 4,000 shots)
| Key | Run | Recovered k | Votes for the right k | Shots on the answer's pattern (noise: 1/2^t) | Two-qubit gates |
|---|---|---|---|---|---|
| 2 bits | ideal | **3 ✓** | 100% | 100% (25%) | — |
| 2 bits | noisy, IBM Torino noise model | **3 ✓** | 80% | 80% (25%) | 51 |
| 3 bits | ideal | **5 ✓** | 100% | 100% (12.5%) | — |
| 3 bits | noisy, IBM Torino noise model | **5 ✓** | 29% | 30% (12.5%) | 501 |

Raw counts: [`sim-2bit.json`](../evidence/quantum/sim-2bit.json), [`sim-3bit.json`](../evidence/quantum/sim-3bit.json).

### Real IBM quantum hardware (6 Nov 2026)
**Shor's algorithm on a real IBM quantum computer recovered the private key from the public key**, on our 2-bit toy curve.

| Key | Machine | Recovered k | Votes for the right k | Shots on the answer's pattern (noise: 1/2^t) | Two-qubit gates · depth | QPU time |
|---|---|---|---|---|---|---|
| 2 bits | **ibm_fez** (IBM Heron, 156 qubits) | **3 ✓** | **69%** (1,333 of 1,942 votes) | 69% (25%) | 46 · 107 | 3 s |

- **The curve:** y² = x³ + x + 2 over F₅, generator G = (1, 2), order 4. The public key is Q = (1, 3), and the secret is k = 3.
- **The run:** job `dbmtusm74qds73dsvrf0`, 4,000 shots, submitted 19:38 IST, finished 21:04 IST (it waited 85 minutes in the free plan's queue and used 3 seconds on the chip).
- **The answer:** 69% of the shots land on the answer's pattern, against 25% if the machine were guessing. The majority vote gives k = 3, and k·G = Q checks out.
- **The noise:** the real chip gave 69%, against 80% in the noisy simulation of IBM Torino. Real hardware is a little noisier than the model, and the right key still wins by a wide margin (1,333 votes; the next best has 249).
- **Raw counts and metadata:** [`ibm-2bit-ibm_fez-dbmtusm74qds73dsvrf0.json`](../evidence/quantum/ibm-2bit-ibm_fez-dbmtusm74qds73dsvrf0.json).

**What this does and doesn't show:**
- **It does show:** the attack Lifeboat is about, going from the public key to the private key with Shor's algorithm, runs on real quantum hardware today, at toy scale.
- **It doesn't show a threat to real keys:** an Ethereum key is 256 bits, not 2, and breaking one needs about 1,200 error-corrected logical qubits (Google Quantum AI, March 2026), each built from many physical ones. No quantum computer can do this to real keys today.

## Run it
Python 3.12 with `qiskit`, `qiskit-aer` and `qiskit-ibm-runtime`.
```bash
python quantum/toy_ecdlp.py plan --bits 2     # the curve, the keys, the circuit
python quantum/toy_ecdlp.py sim  --bits 3     # ideal + noisy simulation
python quantum/toy_ecdlp.py ibm  --bits 2     # real hardware (least busy IBM backend)
python quantum/toy_ecdlp.py fetch --job <id>  # collect a job that finished later
```
The IBM run reads `IBM_QUANTUM_TOKEN` (an IBM Quantum Platform API key) and optionally `IBM_QUANTUM_INSTANCE` (the instance CRN) from `.env`, and never prints them.
