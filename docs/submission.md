# Submission drafts (ETHGlobal form)

**Project name:** Lifeboat

**Short description (one line):** Shows who could take over which wallets, multisigs and ENS names on Q-Day (including keys exposed only through signatures) and moves them to post-quantum accounts.

**Description:**
A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Lifeboat:
1. **Discovers hidden exposure.** It recovers public keys from multisig signatures, which a nonce check never sees. Optimism's Security Council goes from 4 to 13 of 13 public keys, and Base's nested 8-of-11 council from 0 to 11.
2. **Maps who can steer an ENSv2 name** across all five control paths, with the role list proven complete, and hands names over to a post-quantum wallet in a way the registry itself verifies.
3. **Gets people out:** a WOTS+C post-quantum account on EIP-8141 frame transactions, plus a staked rescue paymaster that pays gas for wallets holding tokens but no ETH, which only the ERC-8421 alt mempool allows.
4. **Shows why one-time keys must be one time:** we forged a reused key's signature from 12 public fee bumps in 0.1 s and drained the wallet on the live devnet.
5. **Publishes everything as public evidence:** an Arkiv registry and leaf ledger that anyone can write sightings to, with full bundles on Swarm.

It also includes an ESP32 signer that keeps the counter on the device and can't sign twice. No quantum computer can do this today: these are readiness findings from public data.

**How it's made:**
- **Contracts:** pure Yul, with `verbatim` for the EIP-8141 opcodes (APPROVE, SIGPARAM, SIGDATACOPY, TXPARAM, FRAMEPARAM, FRAMEDATALOAD). The WOTS+C core is templated so the account and a Foundry harness compile the same code. The chain walk is unrolled by a generator (68k → 45k gas) and the digit sum uses SWAR.
- **TypeScript signer** (`@noble/hashes`) with shared test vectors.
- **Frame transactions** via `@forshtat/hegota-support`, submitted through the skandha sidecars, dry-run with `ethrex_simulateFrameTransaction`.
- **Helm check:** viem against ENSv2 (Sourcify ABIs, role bits from the verified sources, Tenderly for full-range logs).
- **Deep scan:** decodes Safe `execTransaction` signatures (Safe 1.3 and 1.4 logs, nested Safes).
- **Arkiv:** `@arkiv-network/sdk` 1.0.1 (named schemas, readonly + permissionless-extension entities, batch writes, keyless reads). **Swarm:** our own Bee 2.8.3 light node in Docker.
- **App:** Vite + React with a strict CSP, on Vercel. **Firmware:** portable C++ verified on the host in an Alpine container.

## Partner prizes

**Ethereum Foundation: Best use of the Frame Transaction Alternative Mempool**
- A post-quantum account in Yul verifies WOTS+C inside the VERIFY frame: 52,369 gas, constant cost, 2,336-byte ARBITRARY witness, and an on-chain leaf floor against reuse.
- The honest reason it needs the alt mempool is a staked rescue paymaster. It reads its registry and a proxied token balance during validation to sponsor token-only wallets, and is repaid in USDC in the same transaction.
- The same signed transaction was rejected by the public mempool (StorageReadNonSender) and by the unstaked alt mempool, and included once the paymaster was staked. Five attack dry-runs are refused.
- We also show the fee-bump danger for one-time keys: a signature forged from 12 reused bumps, accepted by VERIFY and included.
- Explorer links and raw evidence are in the README and `evidence/ef/`.

**ENS: Best Use of ENSv2**
- The Helm check maps every key that can steer any ENSv2 name across five paths (owner, EAC delegates, operators, resolver roles including UPGRADE, parent registries). It rebuilds holders from EACRolesChanged logs and proves the list complete against roleCount.
- The handover is verified by the registry: the naive transfer is refused with TransferUnsafeWithMultipleAssignees; Lifeboat deploys a new PermissionedResolver via VerifiableFactory, points the name at it, revokes the delegate and removes the operator; then the transfer is accepted.
- A WOTS+C wallet then signs its own pq.checked record. A draft ENSIP for pq.* records is included.
- The live demo works with any name.

**Arkiv: Build on Arkiv (+ Swarm bonus)**
- A public Q-Day registry: 24-hour exposure attestations, readonly "aboard" records of verified moves to PQ accounts, ENS verdicts, and a leaf ledger.
- Anyone can write a leaf sighting, so two digests for one leaf raise "signed twice". It caught our naive-wallet demo.
- A publisher re-verifies every claim on-chain before batch-writing. Reads need no key.
- Swarm holds the full evidence bundles, uploaded from our own Bee light node and linked from Arkiv entities via swarmRef. All 8 open on the public testnet gateway.
- Writer wallet and a runnable query are in the README.

**Links:** live demo https://lifeboat-mu.vercel.app · repo (public at submission) https://github.com/Raunakg2005/lifeboat · video: _add_

## Before submitting (Sat 7 Nov, by 09:00 IST)
- [ ] **Refresh Arkiv:** exposure and name entries expire after 24 h (the first batch was written Thu ~22:16). Run `pnpm --filter @lifeboat/scripts swarm-publish` on Sat morning: it re-checks both names and writes fresh entities with `swarmRef`. The Harbour counts come back with it.
- [ ] Check the Bee batch TTL is above 24 h (`curl http://127.0.0.1:1633/stamps`)
- [ ] Hardware: flash the ESP32, run keygen and one signature from the Escape page, add a photo and the log to `docs/hardware.md`
- [ ] Record the video (docs/demo-script.md) and add the link here and in the README
- [ ] Rebuild and redeploy the app (`pnpm --filter @lifeboat/app build`, copy into `deploy/lifeboat`, `vercel deploy deploy\lifeboat --prod`)
- [ ] Make the GitHub repo **public**
- [ ] Fill the form: Finalist + Partner; EF / ENS / Arkiv (+ Swarm bonus box)
