# Hardware signer

A one-time key is only as safe as its counter. The signer keeps the secret seed and the leaf counter on a small device, shows every request on its own screen, needs a physical button press, and **saves the counter before it computes anything**. A crash, a reset or a malicious host can burn a leaf, but it can never make the device sign twice with one.

## Live result: a frame transaction signed by the ESP32 (6 Nov 2026, ~02:10 IST)
| | |
|---|---|
| Device key | generated **on the ESP32** (its TRNG mixed with browser entropy); root `0xf2949ed2…434f` |
| Account | LifeboatAccount `0x1C3FF4E170967ee70E097B7364890732CA7d00cc` (CREATE2 from the device's public key) |
| Transaction | [`0x69c1eaec…9213`](https://explorer.altmempool.wtf/tx/0x69c1eaec36a29185a599ebead5a0662a7198683c352ba98e88dda3daeaf39213?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), chain 1337, **block 406,887, status success**, through the alt mempool |
| How it was signed | The laptop read the public tree from the device and checked its root, built the tx, and found the counter (1,813 tries). The **ESP32 showed SIGN? and waited for the BOOT button**, saved its counter, then streamed the chains. The laptop verified the signature before sending. VERIFY used 52,374 gas |
| Ledger | leaf 1 published to the Arkiv leaf ledger (`0x4f3e2a68…56ba`) |
| Evidence | [`evidence/hardware/esp32-frame-tx.json`](../evidence/hardware/esp32-frame-tx.json) |

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
- `lifeboat_signer.ino`: Arduino glue (NVS counter, OLED, buttons, serial).

**Signing, step by step:**
1. The host (browser or laptop) sends `WOTS|SIGN|<sigHash>|<counter>|<label>`. The counter is found by the host: grinding needs no secret.
2. The device takes the leaf **from its own counter**, recomputes the digest and **refuses** if the digits don't sum to 560. No secret is touched and no leaf is spent.
3. It shows `SIGN? leaf n, tx 0x1234..abcd` on the OLED and waits for **Approve** (the BOOT button, or D18) or Reject (D19), with a 60 s timeout.
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
| `WOTS|SIGN|<sigHash>|<counter>|<label>` | `WOTS|ASK|<leaf>` → (button) → `WOTS|SIG|k/64|<hex>` × 64 → `WOTS|DONE|<leaf>|<keccak(sigs)>`, or `WOTS|ERR|<reason>` |
| `WOTS|EFUSE` | the BLOCK3 coding scheme (read-only; never burns a fuse) |

**Host:** the web app's Escape page → "Hardware signer" uses Web Serial in Chrome or Edge ([`app/src/HardwareSigner.tsx`](../app/src/HardwareSigner.tsx)). It opens the port without toggling DTR/RTS (no auto-reset) and caches the public tree per root.

## Tests
`node tools/firmware-check.mjs` compiles the firmware's crypto core for the host (g++ in a throwaway Alpine container) and checks it against the TypeScript vectors:
```
✅ keccak256('') matches Ethereum
✅ Merkle root matches the TypeScript key
✅ leaf-0 signature accepted the right counter
✅ 64 chain values match the TypeScript signature byte for byte
✅ a wrong counter is refused
```

## Claims we can make / can't make
- ✅ The device never signs two different messages with one leaf, as long as its NVS isn't erased: the counter is saved before signing, and the host can't pick the leaf.
- ✅ Nothing secret leaves the device; the host only ever sees chain values for an approved request.
- ⚠️ **NVS can be erased** (`erase_flash`, an older image), which rolls the counter back. The one-time eFuse counter (one burned bit per signature, 64 signatures, if the chip's BLOCK3 coding scheme is NONE) would survive that; `WOTS|EFUSE` checks the coding scheme. Burning is off by default: eFuse writes are permanent, and Arduino has no virtual-eFuse mode.
- ⚠️ The Dabao's hardware one-way counters would make rollback impossible by design. That's the reason we want it, and it's pending the booth fix.
- ❌ We don't claim side-channel resistance. This is a hackathon signer.

## Bring-up log
- **ESP32:** many charge-only USB cables first. Once on a data cable, Windows showed "CP2102" with an error: the Silicon Labs CP210x driver is needed.
- **Dabao (two boards):** one attempt showed "Unknown USB Device (Device Descriptor Request Failed)", then nothing in any boot mode, on either board, with a cable proven on a phone. The board has the 5.1 k CC resistors, so USB-C to C should work. Reported to Crossbar.

## Licences
Our firmware: MIT. Dabao hardware is CERN-OHL-W-2.0 and xous-core is Apache-2.0 (theirs, not ours).
