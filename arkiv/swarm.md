# Swarm: evidence bundles, referenced from Arkiv

## What goes where
- **Arkiv** holds the small, queryable facts: verdicts, exposures, leaf uses, moves to PQ accounts. Indexed, expiring, signed by the writer.
- **Swarm** holds the full evidence those facts rest on: complete Helm check reports (every role holder and both completeness proofs), the rescue and forgery transaction records, admission reports and raw transactions. They're too big for a 128-byte `str` attribute, and they should stay readable after the Arkiv entity expires.
- **The link:** the optional `swarmRef` column (a 64-hex Swarm reference) on `lifeboat.exposure.v1`, `lifeboat.aboard.v1` and `lifeboat.name.v1` (see [schema.md](schema.md)). It stores a **reference, not a URL**, so any gateway or node can serve it.

## Open one yourself
Arkiv entity **`0x49daf4a3bb109c7cd56c79f316527dec5150c2ce44ec0cb677f9a0aac8e894cc`** (`lifeboat.name.v1`, `lifeboatdemo.eth`, verdict `hijackable`) has

`swarmRef = b27da9a9139a945c83d021f60803995494784479d42b9e9af5165319422de0de`

→ https://api.gateway.testnet.ethswarm.org/bzz/b27da9a9139a945c83d021f60803995494784479d42b9e9af5165319422de0de/ (the full Helm check report)

All three entities from that batch (Arkiv tx `0xd960c0f0a61cf90925bfcae87b4803704a089918eea382818494aaa193c2cdc1`):

| Arkiv entity | Schema | What | Swarm bundle |
|---|---|---|---|
| `0x3f95966c…5773` | name | `lifeboatpq.eth`: protected | [91a0dafc…642d](https://api.gateway.testnet.ethswarm.org/bzz/91a0dafc6752d6acf9c39dfb5281aba72fb41266eefc0a65e1b17e4610ab642d/) |
| `0x49daf4a3…94cc` | name | `lifeboatdemo.eth`: hijackable | [b27da9a9…0de](https://api.gateway.testnet.ethswarm.org/bzz/b27da9a9139a945c83d021f60803995494784479d42b9e9af5165319422de0de/) |
| `0x6e1cd177…6853` | exposure | the naive wallet whose reused key was forged | [1866b023…47b2](https://api.gateway.testnet.ethswarm.org/bzz/1866b02388e81ffd8587bc2b928c9aedf2fa339cbca6ac11d0712c80778547b2/) |

Every uploaded bundle, with the public-gateway check ([`evidence/swarm/swarm.json`](../evidence/swarm/swarm.json)): 8 of 8 open at `https://api.gateway.testnet.ethswarm.org/bzz/<ref>/`:

| Bundle | Reference |
|---|---|
| first PQ frame tx | `486a4f3dd33f6d199d9c6329d2625884ce8d084e5e425c0b7f20ce50a92b6771` |
| rescue (three-way admission) | `69fab974ed2cbb408be4db1c1629698f9fad9672512458ec8f2ce452cdb8bdd4` |
| paymaster guards | `f595ff8b7db858272fe8c2e06f79eef0c57faa571a3087c613840972ea5167e4` |
| forgery demo | `1866b02388e81ffd8587bc2b928c9aedf2fa339cbca6ac11d0712c80778547b2` |
| ENS handover | `e3d23a6aae034169f1cf5edeb22426530d7ca076f44ba5dfeb54d63294875057` |
| Arkiv publish record | `a14250328bc0e034baa57dffabc48050a11e7c33b45413cd8e8c734197a4ec1f` |
| Helm report `lifeboatpq.eth` | `91a0dafc6752d6acf9c39dfb5281aba72fb41266eefc0a65e1b17e4610ab642d` |
| Helm report `lifeboatdemo.eth` | `b27da9a9139a945c83d021f60803995494784479d42b9e9af5165319422de0de` |

## Postage batch and node
- **Batch ID:** `d65b35d84fb16b2811f5cbb0a1b5d00045c074bd43ac2a04014e7266bd3a7bae`. Depth 18, ~72 h TTL (bought 6 Nov 2026 ~00:10 IST, so it lasts through judging). Purchase tx `0xc8669c51715ff7c747251b7e8b456e3ef290e34c60f1e21b858087adb7faba23` on Sepolia.
- **Bought by:** the Bee node's wallet `0xf7E0dbAA225fFdBA49aBbdf9d52Ca3B3842B2466` (chequebook `0x07b8c94fC323799df155C9392823132f6c9C69c8`). It was funded with 0.075 sBZZ swapped on Sepolia Uniswap; the batch cost ~0.0556 sBZZ.
- **Node:** our own **Bee 2.8.3 light node** (`ethersphere/bee:2.8.3` in Docker), Swarm testnet (network 10, Sepolia), API on `127.0.0.1` only, CORS limited to the Vite dev origin.

## Files
- **Upload and link:** [`scripts/src/swarm-publish.ts`](../scripts/src/swarm-publish.ts).
  1. Reuse or buy a batch (`POST /stamps/{amount}/{depth}`), waiting until it's usable.
  2. `POST /bzz?name=…` with `swarm-postage-batch-id`.
  3. Read back through the local node (byte-for-byte compare) and the public gateway.
  4. Re-run the Helm checks, then `executeBatch` the Arkiv entities with `swarmRef`.
- **Read:** the web app's Harbour and Scan views turn `swarmRef` into a gateway link ([`app/src/HarbourView.tsx`](../app/src/HarbourView.tsx), [`app/src/CheckView.tsx`](../app/src/CheckView.tsx)).

## Run one upload and one read
```bash
docker run -d --name lifeboat-bee … ethersphere/bee:2.8.3 start --mainnet=false --network-id=10 --full-node=false --swap-enable=true --blockchain-rpc-endpoint=https://ethereum-sepolia-rpc.publicnode.com …
pnpm --filter @lifeboat/scripts swarm-publish --hours 72
curl https://api.gateway.testnet.ethswarm.org/bzz/b27da9a9139a945c83d021f60803995494784479d42b9e9af5165319422de0de/
```

## Video
The Swarm part is in the Harbour section of the demo video (timestamp added when the video is cut: see the README).

## What got in our way
1. **"cannot create batch" (HTTP 500) with no reason.** Bee's log said only `create batch: create failed`. The cause was our blockchain RPC: the public Tenderly gateway (chosen because it keeps full log history for the postage sync) **rate-limits `eth_sendRawTransaction`**. Switching the node's RPC to publicnode after the sync fixed it. *Suggestion:* surface the RPC error in the API response.
2. Funding takes two tokens on two paths: Sepolia ETH for the node's gas, and sBZZ from a Uniswap testnet pool, since the Discord faucet is gone.
3. A new stamp takes a few minutes to become `usable`; the script polls `/stamps/{id}`.
4. Nothing encrypted: these bundles are public evidence by design.
