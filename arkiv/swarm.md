# Swarm: evidence files, referenced and verified from Arkiv

## What goes where
- **Arkiv** holds the small, queryable facts: verdicts, exposures, one-time-key uses, moves to post-quantum accounts. They are indexed, expiring and signed by the writer.
- **Swarm** holds the full evidence those facts rest on:
  - complete Helm check reports (every role holder and both completeness proofs);
  - the rescue, forgery and frame-transaction records;
  - admission reports and raw transactions;
  - the council scan.
  These are too big for a 128-byte attribute, and they stay readable after a 24-hour Arkiv reading expires.
- **The link:** two optional columns on `lifeboat.exposure.v1`, `lifeboat.aboard.v1` and `lifeboat.name.v1` (see [schema.md](schema.md)):
  - `swarmRef`: a 64-hex Swarm reference. It's a reference, not a URL, so any gateway or node can serve it.
  - `evidenceHash`: the keccak256 of the exact bytes uploaded.
- **The check:** the app's **open evidence** button (Harbour, Check, Home) downloads the file from Swarm and hashes it **in the browser**. It compares the hash with the record's `evidenceHash` and shows "Swarm file matches the Arkiv record". It also checks that the block, verdict or status and the name or address in the file agree with the record. So nobody has to trust the gateway, or us, for the file to be the one the record was written from.

## Open one yourself
Arkiv entity [`0x49daf4a3bb109c7cd56c79f316527dec5150c2ce44ec0cb677f9a0aac8e894cc`](https://rabdi.explorer.arkiv.network/entity/0x49daf4a3bb109c7cd56c79f316527dec5150c2ce44ec0cb677f9a0aac8e894cc). It's a `lifeboat.name.v1` record for **our own test name** `lifeboatdemo.eth`, verdict `hijackable`, checked at Sepolia block 12,076,287. It holds:
- `swarmRef = 54d6ab918f90f9b90d5311a2c0707838c95be674287a910ba7d99d37a8825399`
- `evidenceHash = 0xb280f56bf7b6853bf8befe423b3d56516cf001b65f6a8f7de712420020bcf9db`

→ https://api.gateway.testnet.ethswarm.org/bzz/54d6ab918f90f9b90d5311a2c0707838c95be674287a910ba7d99d37a8825399/ (the full Helm check report)

Re-checks update this record in place, so **the key stays the same** and its expiry is extended. The `swarmRef` changes only when there's a newer report.

The current Swarm-linked records (Arkiv batch [`0x919d16d9…11e4`](https://rabdi.explorer.arkiv.network/tx/0x919d16d93694321b31dcc55862495806113e6549f44668b59d7ec358954e11e4), 6 Nov):

| Arkiv entity | Schema | What | Swarm file |
|---|---|---|---|
| [`0x3f95966c…5773`](https://rabdi.explorer.arkiv.network/entity/0x3f95966ca70d7533cf0cb097d3d30d2823b3c7c79d20c88d43d24ebdc95f5773) | name | `lifeboatpq.eth` (our test name): protected | [381d7e95…abf9](https://api.gateway.testnet.ethswarm.org/bzz/381d7e95a54750f02c7384e305724f4c118e6a0337c7badd95362ee05d95abf9/) |
| [`0x49daf4a3…94cc`](https://rabdi.explorer.arkiv.network/entity/0x49daf4a3bb109c7cd56c79f316527dec5150c2ce44ec0cb677f9a0aac8e894cc) | name | `lifeboatdemo.eth` (our test name): hijackable | [54d6ab91…5399](https://api.gateway.testnet.ethswarm.org/bzz/54d6ab918f90f9b90d5311a2c0707838c95be674287a910ba7d99d37a8825399/) |
| [`0x6e1cd177…6853`](https://rabdi.explorer.arkiv.network/entity/0x6e1cd17777eeadabfc22507cd625ce91ad7e48cec0e851c527f1a7adf50b6853) | exposure | our naive test wallet, whose reused key was forged | [8184ff03…b449](https://api.gateway.testnet.ethswarm.org/bzz/8184ff0357fba794dc5eb17775a8fe3133b46ce68b77371da8c50620429cb449/) |
| [`0x92f03757…54d7`](https://rabdi.explorer.arkiv.network/entity/0x92f03757e848e8a7688716012ba39588e055c7c3261a27403cdb296bc8d554d7) | aboard | the sponsored rescue (readonly) | [06796fb1…6c9a](https://api.gateway.testnet.ethswarm.org/bzz/06796fb1e0d945f40e3a1a9a55a88636d93dc43c1d9da16bb923f8a8b3416c9a/) |
| [`0x5f9b4901…7854`](https://rabdi.explorer.arkiv.network/entity/0x5f9b490132fb56924f424adce8cf81d6c3a042490153cd13ba55ebd287177854) | aboard | the ENS handover (readonly) | [e3d23a6a…5057](https://api.gateway.testnet.ethswarm.org/bzz/e3d23a6aae034169f1cf5edeb22426530d7ca076f44ba5dfeb54d63294875057/) |
| 4 × exposure | exposure | the council Safes (Arkiv batch [`0x40e4baf4…1f63`](https://rabdi.explorer.arkiv.network/tx/0x40e4baf4d71e05fb765bf6807e7e56d378b191ebc0188134d34597d246cd1f63)) | [d4019f0c…e8ae](https://api.gateway.testnet.ethswarm.org/bzz/d4019f0c24caaff31d17a593d905aa7e846a4395061ed8a8cbf8f9c7b34ee8ae/) |

All 9 files from this run, uploaded pinned, read back through our node and the public gateway, and keccak-checked ([`evidence/swarm/swarm.json`](../evidence/swarm/swarm.json), [`evidence/discovery/arkiv-publish.json`](../evidence/discovery/arkiv-publish.json)):

| File | Reference |
|---|---|
| frame transaction, leaf 2 (after the devnet reset) | `a50686be1785c7874d666a128a8ff44c627ea33bfb4e0def9a421f30c7ec22f8` |
| rescue (three-way admission) | `06796fb1e0d945f40e3a1a9a55a88636d93dc43c1d9da16bb923f8a8b3416c9a` |
| paymaster guards | `5a675a05e55ad8b581c9651856d2007cb3ada5b42e4ec7be08b6fc2df3ffadf9` |
| forgery demo | `8184ff0357fba794dc5eb17775a8fe3133b46ce68b77371da8c50620429cb449` |
| ENS handover | `e3d23a6aae034169f1cf5edeb22426530d7ca076f44ba5dfeb54d63294875057` |
| Arkiv publish record | `152c3f189e2a44e63df9b983aa8bc2dc4877aaf80f2dd0007a91ce513b8e5e7e` |
| Helm report `lifeboatpq.eth` | `381d7e95a54750f02c7384e305724f4c118e6a0337c7badd95362ee05d95abf9` |
| Helm report `lifeboatdemo.eth` | `54d6ab918f90f9b90d5311a2c0707838c95be674287a910ba7d99d37a8825399` |
| council scan | `d4019f0c24caaff31d17a593d905aa7e846a4395061ed8a8cbf8f9c7b34ee8ae` |

## Postage batch and node
- **Batch ID:** `d65b35d84fb16b2811f5cbb0a1b5d00045c074bd43ac2a04014e7266bd3a7bae`, depth 18. Bought 6 Nov 2026 ~00:10 IST with purchase tx `0xc8669c51715ff7c747251b7e8b456e3ef290e34c60f1e21b858087adb7faba23` on Sepolia. At 15:44 IST on 6 Nov it had 55.9 h left, so it lasts until about **Sun 8 Nov 23:40 IST**. The Monitor checks the batch TTL and raises an `evidence-at-risk` alert under 24 h.
- **Bought by:** the Bee node's wallet `0xf7E0dbAA225fFdBA49aBbdf9d52Ca3B3842B2466` (chequebook `0x07b8c94fC323799df155C9392823132f6c9C69c8`). It was funded with 0.075 sBZZ swapped on Sepolia Uniswap, and the batch cost ~0.0556 sBZZ.
- **Node:** our own **Bee 2.8.3 light node** in Docker on the Swarm testnet (network 10, Sepolia). The API listens on `127.0.0.1:1633` only, with CORS limited to the Vite dev origin.

## Files
- **Upload:** [`scripts/src/lib/swarm.ts`](../scripts/src/lib/swarm.ts). It sends `POST /bzz` with `swarm-postage-batch-id`, `swarm-pin: true` and `swarm-deferred-upload: false`, then reads back through our node and the gateway and compares keccak hashes. It also has the stamp and stewardship checks.
- **Upload and link:** [`scripts/src/swarm-publish.ts`](../scripts/src/swarm-publish.ts). It runs the Helm checks first, uploads **those exact reports**, then writes or updates the Arkiv records with `swarmRef` and `evidenceHash` in one `executeBatch`. [`scripts/src/discovery-publish.ts`](../scripts/src/discovery-publish.ts) does the same for the council scan.
- **Health:** [`scripts/src/monitor.ts`](../scripts/src/monitor.ts) checks the batch TTL (`/stamps`) and that every reference is still retrievable (`/stewardship/<ref>`).
- **Read and verify:** [`app/src/EvidenceDrawer.tsx`](../app/src/EvidenceDrawer.tsx) and [`app/src/lib.ts`](../app/src/lib.ts) fetch, hash and compare. The drawer is used from [`HarbourView.tsx`](../app/src/HarbourView.tsx), [`CheckView.tsx`](../app/src/CheckView.tsx) and [`HomeView.tsx`](../app/src/HomeView.tsx).

## Run one upload and one read
Start the node. This is the exact command we use; put your own password in `%USERPROFILE%\.lifeboat-bee\password`:
```bash
docker run -d --name lifeboat-bee -p 127.0.0.1:1633:1633 -p 1634:1634 -v lifeboat-bee-data:/home/bee/.bee -v "%USERPROFILE%\.lifeboat-bee:/secrets" ethersphere/bee:2.8.3 start --mainnet=false --network-id=10 --bootnode=/dnsaddr/sepolia.testnet.ethswarm.org --full-node=false --swap-enable=true --blockchain-rpc-endpoint=https://ethereum-sepolia-rpc.publicnode.com --postage-sync-block-range=5000 --api-addr=:1633 --p2p-addr=:1634 --cors-allowed-origins=http://localhost:5173 --password-file=/secrets/password
```
A light node needs a little Sepolia ETH and sBZZ in its wallet before it can buy a batch (`POST /stamps/<amount>/18`).

**Upload one file** (with a usable batch):
```bash
curl -s -X POST "http://127.0.0.1:1633/bzz?name=forgery.json" -H "swarm-postage-batch-id: d65b35d84fb16b2811f5cbb0a1b5d00045c074bd43ac2a04014e7266bd3a7bae" -H "swarm-pin: true" -H "Content-Type: application/json" --data-binary @evidence/ef/forgery.json
```
You should see `{"reference":"<64 hex>"}`.

**Read one** (no node needed):
```bash
curl -s https://api.gateway.testnet.ethswarm.org/bzz/54d6ab918f90f9b90d5311a2c0707838c95be674287a910ba7d99d37a8825399/
```
You should see the JSON Helm report for `lifeboatdemo.eth`, with `"verdict": "hijackable"` and block 12,076,287. In the app, Harbour → Names → **open evidence** shows the same file with the "matches the Arkiv record" seal.

**The whole pipeline:**
```bash
pnpm --filter @lifeboat/scripts swarm-publish --dry-run
pnpm --filter @lifeboat/scripts swarm-publish
```
`--dry-run` does every check and prints the hashes and the planned Arkiv updates without uploading. The real run needs `.env` with the publisher key.

## Video
**3:21–3:40** in the submission video (chapter "Publish, and the close"). Harbour opens **open evidence** on `lifeboatpq.eth`: the Swarm file is fetched, hashed in the browser, and shown as **"Swarm file matches the Arkiv record"**, with block, verdict and name checked against the record. The narration at **3:29** explains it.

## What got in our way
1. **"cannot create batch" (HTTP 500) with no reason.** Bee's log said only `create batch: create failed`. The cause was our blockchain RPC: the public Tenderly gateway (chosen because it keeps full log history for the postage sync) **rate-limits `eth_sendRawTransaction`**. Switching the node's RPC to publicnode after the sync fixed it. *Suggestion:* surface the RPC error in the API response.
2. **Funding takes two tokens by two routes:** Sepolia ETH for the node's gas, and sBZZ from a Uniswap testnet pool, since the Discord faucet is gone.
3. **A new stamp takes a few minutes to become usable;** the script polls `/stamps/{id}`.
4. **Nothing is encrypted:** these files are public evidence by design. Private disclosures never go on Swarm or Arkiv. An encrypted reference contains its key and can't be revoked.
