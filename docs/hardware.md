# Hardware signer

A one-time key is only as safe as its counter. The signer keeps the secret seed and the leaf counter on a small device, shows every request on its own screen, needs a physical button press, and **saves the counter before it computes anything**. A crash, a reset or a malicious host can burn a leaf, but it can never make the device sign twice with one.

## Live result: a clear-signed frame transaction from the ESP32 (6 Nov 2026, ~16:35 IST)
| | |
|---|---|
| Device key | generated **on the ESP32** (its TRNG mixed with browser entropy); root `0xf2949ed2…434f` |
| Account | LifeboatAccount `0x1C3FF4E170967ee70E097B7364890732CA7d00cc` (CREATE2 from the device's public key) |
| Transaction | [`0x6836931d…6737`](https://explorer.altmempool.wtf/tx/0x6836931d3ad4ff86713e552e2ef3d2d49a84d62676f3ef816c77a580fdf66737?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), chain 1337, **block 2,687, status success**, through the alt mempool |
| How it was signed | **Clear signing:** the laptop sent the unsigned transaction itself. The ESP32 rebuilt the hash from it, reported the same hash, and showed the transaction in words page by page: chain, sender, nonce, the VERIFY and SENDER frames, "send 0.001 ETH" with the full recipient, and the max fee. It signed after the BOOT press on the last page, using leaf 3 with the counter saved first. The laptop verified the signature before sending. VERIFY used 52,350 gas |
| Ledger | leaf 3 published to the Arkiv leaf ledger (`0xa6a1b7a2…8a94`) |
| Evidence | [`evidence/hardware/esp32-frame-tx-clear-signed.json`](../evidence/hardware/esp32-frame-tx-clear-signed.json) |

Earlier the same day (02:10 IST), the device signed its first frame transaction (block 406,887) with the older blind protocol, on the devnet before its 6 Nov reset. The receipt is kept in [`evidence/hardware/esp32-frame-tx.json`](../evidence/hardware/esp32-frame-tx.json).

Before that, a test message signed through the web app's Web Serial panel (leaf 0) came back **valid**.

**Measured on this ESP32 (240 MHz, both cores):**
- Key generation (256 leaves, about 266k Keccak permutations): **35.0 s** with both cores, against ~66.7 s on one.
- Exporting the public tree: **1.8 s** once it's cached in NVS (37 s the first time).
- The counter and key survive reflashing the app.
- `WOTS|EFUSE` reports BLOCK3 coding scheme **NONE**, so the burn-a-fuse-per-signature counter is possible on this chip.

## Boards
| Board | Role | Status (6 Nov 2026) |
|---|---|---|
| **ESP32 DevKit V1** | main signer | ✅ Working: key generated on-device, a frame transaction signed with it and included on chain 1337 (above). Crypto core also verified byte for byte against the TypeScript signer on the host |
| Crossbar **Dabao** (Baochip-1x) | planned: hardware one-way counters, on-chip TRNG | Neither of our two boards enumerated over USB on Windows ("Device Descriptor Request Failed" once, then nothing). Taken to the Crossbar booth |
| Arduino Uno R3 + SSD1306 OLED | spare / display test | Working (OLED found at I2C 0x3C) |

## Wiring (ESP32, 3.3 V)
| Part | ESP32 pin |
|---|---|
| OLED SDA | GPIO 21 |
| OLED SCL | GPIO 22 |
| OLED VCC / GND | 3V3 / GND |
| Approve | the board's own **BOOT** button (GPIO 0, read only after boot); optionally a button D18 → GND |
| Reject | optional button D19 → GND, or just let the 60 s timeout cancel |

## Firmware
[`firmware/esp32/lifeboat_signer/`](../firmware/esp32/lifeboat_signer/):
- `keccak.h`: Keccak-256 (Ethereum padding), portable C++.
- `wots.h`: the WOTS+C core, mirroring `packages/pq` exactly.
- `clear.h`: **clear signing**. It turns each request into the hash to sign and the lines to show, with no Arduino code, so the same file runs in the host test.
- `lifeboat_signer.ino`: Arduino glue (NVS counter, OLED, buttons, serial).

## Clear signing: the device shows what it signs
The device **never signs a bare hash**. A hacked laptop could otherwise ask for one thing on its own screen and get a signature for another. Instead, the host sends the request's own fields. The device rebuilds the hash from them and shows the same bytes in words:

| Request | The device rebuilds | The screen shows |
|---|---|---|
| `MSG`: a text message | `keccak("\x19Lifeboat Signed Message:\n" ‖ len ‖ text)` (printable ASCII only) | the text |
| `PQW`: a post-quantum wallet action (ENS records, payments, tokens) | `LifeboatPQWallet.digest(leaf, deadline, calls)`, from the ABI-encoded calls (canonical encoding only) | chain, wallet, deadline, then each call: "send 0.01 ETH" with the full recipient address, `transfer` with amount, ENS `setText` with the **name** and record (decoded from the DNS-encoded name), `setResolver`, role grants… |
| `SAFE`: a Quantum Guard co-signature | the Safe 1.4.1 EIP-712 transaction hash, then the guard digest | Safe, nonce, what the transaction does, `! DELEGATECALL` and each call inside a `multiSend`, any gas refund |
| `FRAME`: an EIP-8141 frame transaction | `keccak` of the unsigned transaction (RLP decoded on the device) | chain, sender, nonce, each frame (VERIFY / SENDER / DEFAULT), "send 0.001 ETH" + full recipient, max fee |

Unusual things start with `!` (delegatecall, unlimited approvals, new owners, unknown functions, mainnet). Long requests are split into pages. **BOOT moves to the next page, and only on the last page does BOOT sign**, so every line has been on screen before anything is signed.

The device refuses, before touching the secret or spending a leaf:
- a bare hash (`WOTS|SIGN` → `blind-signing-off`);
- a request that names another leaf;
- non-canonical call encoding;
- a frame transaction whose signature bytes aren't elided;
- a message with control characters;
- a counter that doesn't match its own digest;
- anything too long to show.

**Signing, step by step:**
1. The host builds the request ([`packages/core/src/device.ts`](../packages/core/src/device.ts)), computes the same hash and finds the counter. Grinding needs no secret.
2. The device takes the leaf **from its own counter**, rebuilds the hash from the request and recomputes the digest. It **refuses** if the digits don't sum to 560. No secret is touched and no leaf is spent.
3. It reports the hash it built (`WOTS|HASH|…`, which the host compares with its own), shows the request page by page, and waits for **Approve** (the BOOT button, or D18) or Reject (D19). It times out after 90 s, and a timeout uses no leaf.
4. On Approve it writes `next = n + 1` to NVS, reads it back, and halts if that fails. **Then** it walks the 64 chains and streams them.
5. The host assembles the witness with its own copy of the public Merkle tree and **verifies it** before using it.

**Keys:** `WOTS|KEYGEN|<host entropy>`. The seeds are `keccak(device TRNG ‖ host entropy ‖ tag)`, so neither side alone decides the key. The device's TRNG uses `bootloader_random_enable()` where the core provides it. The device streams the 256 public leaf hashes; the host builds the tree and checks the root against the device's.

## Protocol (115200 baud; every line starts with `WOTS|`)
| Command | Reply |
|---|---|
| `WOTS|PING` | `WOTS|PONG` |
| `WOTS|INFO` | `WOTS|INFO|<next>|<pubSeed>|<root>` or `WOTS|INFO|NOKEY` |
| `WOTS|KEYGEN|<hex32>` | `WOTS|LH|<i>|<leafHash>` × 256, then `WOTS|ROOT|<root>` |
| `WOTS|LEAVES` | re-streams the public leaf hashes and root |
| `WOTS|MSG|<counter>|<text hex>` | `WOTS|HASH|<hash>`, `WOTS|ASK|<leaf>` → (pages, button) → `WOTS|SIG|k/64|<hex>` × 64 → `WOTS|DONE|<leaf>|<keccak(sigs)>`, or `WOTS|ERR|<reason>` |
| `WOTS|PQW|<counter>|<chainId>|<wallet>|<leaf>|<deadline>|<abi.encode(calls)>` | same |
| `WOTS|SAFE|<counter>|<chainId>|<guard>|<safe>|<to>|<value>|<data>|<op>|<safeTxGas>|<baseGas>|<gasPrice>|<gasToken>|<refundReceiver>|<nonce>` | same |
| `WOTS|FRAME|<counter>|<unsigned tx>` | same |
| `WOTS|SIGN|…` (a bare hash) | `WOTS|ERR|blind-signing-off` |
| `WOTS|SETPIN|<pin hex>` | the device asks (BOOT) → `WOTS|PINSET`: the seed is stored encrypted, the plaintext copy erased |
| `WOTS|UNLOCK|<pin hex>` | `WOTS|UNLOCKED`, or `WOTS|ERR|bad-pin|<wrong in a row>` (waits grow after 3, kept across reboots) |
| `WOTS|LOCK` | `WOTS|LOCKED`: the seed is wiped from memory |
| `WOTS|WIPE` | hold BOOT 5 s → `WOTS|WIPED`: the key is erased for good |
| `WOTS|I2C`, `WOTS|PINSCAN`, `WOTS|LINES` | screen diagnostics: which address answers, which pins a screen is on, which lines a powered screen holds high |
| `WOTS|EFUSE` | the BLOCK3 coding scheme (read-only; never burns a fuse) |

**Host:** the web app's Escape page → "Hardware signer" uses Web Serial in Chrome or Edge ([`app/src/HardwareSigner.tsx`](../app/src/HardwareSigner.tsx)). It opens the port without toggling DTR/RTS (no auto-reset). It keeps the public tree **in memory only** and re-reads it from the device on connect (1.8 s), so the browser saves nothing.

## Tests
`node tools/firmware-check.mjs` compiles the firmware's crypto core and `clear.h` for the host (g++ in a throwaway Alpine container). It checks them against the TypeScript signer's vectors, and against 11 clear-signing requests built by the host code ([`gen-device-vectors.ts`](../scripts/src/gen-device-vectors.ts)). The expected hashes come from the contract's `walletDigest`, Safe's EIP-712 hash plus the guard digest, and the frame library's `sigHash`. **22 of 22 pass:**
```
✅ keccak256('') matches Ethereum
✅ Merkle root matches the TypeScript key
✅ leaf-0 signature accepted the right counter
✅ 64 chain values match the TypeScript signature byte for byte
✅ a wrong counter is refused
✅ clear signing: message / ENS set text / payment + token / Safe payment / Safe install (delegatecall batch) / frame tx:
   same hash as the host, and the screen shows the details (12 checks)
✅ clear signing refuses: another leaf, non-canonical calls, signature bytes left in, a hidden control character, a bare hash
```
On the real ESP32 (`pnpm --filter @lifeboat/scripts hw-clear-test`, [`evidence/hardware/clear-signing.json`](../evidence/hardware/clear-signing.json)):
- a bare hash, a wrong counter and a request for another leaf were all refused, with no leaf used;
- the device rebuilt the same hash from the message, showed it, and signed after BOOT;
- the signature verifies against its public tree, and the counter moved by exactly one.

Timeouts use no leaf either.

## Claims we can make / can't make
- ✅ The device never signs two different messages with one leaf, as long as its NVS isn't erased: the counter is saved before signing, and the host can't pick the leaf.
- ✅ Nothing secret leaves the device; the host only ever sees chain values for an approved request.
- ✅ **PIN lock:** the seed is stored encrypted (key = the PIN stretched 20,000 times with keccak and a random salt). After every power-on the device is locked until the PIN is entered; wrong PINs bring growing waits that survive reboots. Set it in the app (Escape → Hardware signer) or with `pnpm --filter @lifeboat/scripts hw-pin --set` (reads `DEVICE_PIN` from `.env`).
  Live on the ESP32 (6 Nov, [`evidence/hardware/pin-lock.json`](../evidence/hardware/pin-lock.json)): PIN set; while locked a signing request is refused (`WOTS|ERR|locked`); a wrong PIN is refused; the right PIN unlocks it, and it signs again (leaf 5, signature verified).
- ✅ **Testnet only:** the device refuses any chain except Sepolia and the EIP-8141 devnet, whatever the laptop sends.
- ✅ **What you approve is what gets signed:** the device builds the hash from the same bytes it shows, so a hacked laptop can't swap the request.
- ⚠️ With a PIN set, the seed in flash is encrypted with a key stretched from the PIN. But someone with the device and a lot of time could still read the flash and guess a short PIN offline. Production adds the ESP32's flash encryption and secure boot: permanent eFuse settings, tested on a spare board first. It also adds the one-way counter below.
- ⚠️ **NVS can be erased** (`erase_flash`, an older image), which rolls the counter back. The one-time eFuse counter (one burned bit per signature, 64 signatures, if the chip's BLOCK3 coding scheme is NONE) would survive that; `WOTS|EFUSE` checks the coding scheme. Burning is off by default: eFuse writes are permanent, and Arduino has no virtual-eFuse mode.
- ⚠️ The Dabao's hardware one-way counters would make rollback impossible by design. That's the reason we want it, and it's pending the booth fix.
- ❌ We don't claim side-channel resistance. This is a hackathon signer.

## Bring-up log
- **ESP32:** many charge-only USB cables first. Once on a data cable, Windows showed "CP2102" with an error: the Silicon Labs CP210x driver is needed.
- **Dabao (two boards):** one attempt showed "Unknown USB Device (Device Descriptor Request Failed)", then nothing in any boot mode, on either board, with a cable proven on a phone. The board has the 5.1 k CC resistors, so USB-C to C should work. Reported to Crossbar.

## Licences
Our firmware: MIT. Dabao hardware is CERN-OHL-W-2.0 and xous-core is Apache-2.0 (theirs, not ours).
