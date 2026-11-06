# Helm check: who can steer an ENSv2 name on Q-Day

Moving your money to a post-quantum wallet isn't enough. If a quantum-breakable key can still steer your **name**, an attacker can point `you.eth` at their own address, and every payment sent to it is theirs. In ENSv2, control of a name is spread over five places, and a plain transfer of the name moves only one of them.

Code: [`packages/core/src/helm.ts`](../packages/core/src/helm.ts) (shared by the app and the scripts) · CLI: `pnpm --filter @lifeboat/scripts helm <name.eth>` · works for **any** ENSv2 name on Sepolia (nothing hard-coded).

## The five paths

| # | Path | Where it lives | How we read it |
|---|---|---|---|
| 1 | **Owner** | the name's token in its parent registry | `findParentRegistry`, `findTokenId`, `getOwner` |
| 2 | **Delegates**: other accounts with roles on the name (`SET_RESOLVER`, `SET_SUBREGISTRY`, `RENEW`, `UNREGISTER`, their admins) | Enhanced Access Control on the registry | `EACRolesChanged` logs filtered by the name's `resource`, then `roles(resource, account)` |
| 3 | **Operators**: accounts approved for all of the owner's names (ERC-1155): they can move the name | the registry | `ApprovalForAll` logs for the owner, then `isApprovedForAll` |
| 4 | **Resolver role holders**: can rewrite the address and text records; **`UPGRADE` can replace the resolver's code** | the name's PermissionedResolver (a UUPS proxy) | `EACRolesChanged` logs on the resolver, every resource |
| 5 | **Parent registries**: root-role holders of every registry above the name | `.eth` registry, root registry | `findRegistries`, root-resource `EACRolesChanged` |

Each holder is classified:
- 🔴 **exposed**: an EOA that has sent a transaction, so its public key is on-chain.
- 🟡 **not seen**: an EOA with no transactions; its key isn't revealed yet.
- 🟢 **PQ**: a LifeboatPQWallet.
- ⚪ **contract**: Safes are flagged for a deeper signer scan.

**Verdict:** *hijackable on Q-Day* if any path 1–4 holder is exposed. Path 5 is reported as systemic (outside the owner's control).

### Proving the role list is complete
EAC stores only role **counts** on-chain, not the list of holders. We rebuild holders from logs, then prove completeness: every role is one nybble, so the **sum of all holders' role bitmaps must equal `roleCount(resource)`**. If it doesn't, the verdict is *unknown*, never a false "protected".

### The resolver trap
Transferring the name doesn't touch its resolver. The old key keeps every role on the old resolver, including `SET_ADDRESS` (redirect payments) and `UPGRADE` (replace the code). A handover must point the name at a resolver the new owner controls.

## Live demo on Sepolia ENSv2 (5 Nov 2026)

Name: **`lifeboatpq.eth`**. PQ wallet: `0x2e58B0f2336dFe76b8bbAb1BfD927E354CBC997F` (WOTS+C, see [pq-account.md](pq-account.md)).

### Before (block 12,070,629): **hijackable through paths 1, 2, 3, 4**
| Path | Holder | Power |
|---|---|---|
| 1 owner | 🔴 dev EOA | owns the token |
| 2 delegate | 🔴 EOA | `SET_RESOLVER` |
| 3 operator | 🔴 EOA | can transfer the name |
| 4 resolver | 🔴 dev EOA | every resolver role incl. `UPGRADE` |
| 5 parents | 1 🔴 EOA + 4 registrar/renewal contracts | systemic |

Both role lists were **proven complete**. Report: [`evidence/ens/helm-lifeboatpq.eth-12070629.json`](../evidence/ens/helm-lifeboatpq.eth-12070629.json)

### The handover (every step is a Sepolia transaction)
| Step | Tx | Result |
|---|---|---|
| 1. naive `safeTransferFrom` to the PQ wallet | `0x9f8f9c2629c198d7deeca5158f779067942086c47542dc46382b038b057584c1` | ❌ **refused by the registry: `TransferUnsafeWithMultipleAssignees`** (another account still holds roles) |
| 2. new resolver for the PQ wallet via VerifiableFactory; `pq.*` records set at `initialize` | `0x9cd30d1701620903a96778bb5a39d6e216fc65be4baa4e775d333a38c122b05e` | ✅ the relayer holds **0** roles on it |
| 3. `setResolver` to it (escapes the resolver trap) | `0xee330c7b780ad20f0925241e1ccaa7e3072a9c9c886dae21e5d16f214302861a` | ✅ |
| 4. revoke the delegate's `SET_RESOLVER` | `0x308a500e9130eb4ff3cb9486b7c98f0493afb3c55cfaa49a1a744cf29eef7dff` | ✅ (the token id regenerates, so it's re-read) |
| 5. remove the operator | `0x02d31d775dff34697dac9a1ddffaa9456ff33fbd6a8b57ae21882ef7d0f773bb` | ✅ |
| 6. `safeTransferFrom` to the PQ wallet | `0x2509d99b9997dc90a35a1c5ffef23f697797797ea22ace5bba04175479be206a` | ✅ **accepted** |
| 7. the PQ wallet writes `pq.checked` with a **WOTS+C signature** (leaf 0), relayed by anyone | `0x652d20aec4e1cd9f2d3bf4209240040ba03601284a76438cc2b0e004db380c18` | ✅ |

### After (block 12,070,648): **protected**
| Path | Holder |
|---|---|
| 1 owner | 🟢 PQ wallet |
| 2 delegates | none |
| 3 operators | none |
| 4 resolver | 🟢 PQ wallet only |

Role lists proven complete again. Report: [`evidence/ens/helm-lifeboatpq.eth-12070648.json`](../evidence/ens/helm-lifeboatpq.eth-12070648.json). All steps: [`evidence/ens/handover.json`](../evidence/ens/handover.json).

Records, read through the Universal Resolver with plain viem (`getEnsAddress` / `getEnsText`):
```
addr        0x2e58B0f2336dFe76b8bbAb1BfD927E354CBC997F
pq.status   protected
pq.scheme   WOTS+C-keccak-w16-S560-h8
pq.root     0x66e62586006341ac1446701f79124740ea0e333b6a456414a014d7647825c015
pq.account  0x2e58b0f2336dfe76b8bbab1bfd927e354cbc997f
pq.checked  2026-11-05T16:24:03.097Z signed by the PQ key
```

## With a hardware key: `lifeboathw.eth` (6 Nov 2026)
The same handover, but to a post-quantum wallet whose key exists **only on the ESP32**. Every later change to the name is shown on the device's screen and signed only after its button is pressed.

- **The wallet comes from the device:** the LifeboatPQWallet is deployed with CREATE2, salt = the device's key root. Its address follows from the device's public key alone, `0xc2B0329000BDaC7E0C9F29D8986F3B86eF987e7C`, so the app finds it from the device and saves nothing. The Helm check recognises it from the chain alone: it reads `root()` and `pubSeed()`, recomputes the address and compares.
- **Before** (block 12,076,200): **hijackable through paths 1, 3, 4**. The owner was an exposed key, the operator `0xBE65…e630` had a public key, and the old resolver was controlled by an exposed key. This name had no extra delegate, so ENSv2 would have accepted a naive transfer, and the old resolver's exposed keys would still have controlled every record.

| Step | Transaction |
|---|---|
| Deploy the device's PQ wallet (CREATE2 from its public key; whoever sends it gets no control) | [`0x3e608add…`](https://sepolia.etherscan.io/tx/0x3e608adda2b21dd0e4017a13f2e1d7d39442dd1561e076e15ba1a0654d7bff77), block 12,076,200 |
| A fresh resolver where only the PQ wallet holds roles, `pq.*` records set at creation (the sender kept 0 roles) | [`0x4b372174…`](https://sepolia.etherscan.io/tx/0x4b372174820319feb1e88fa3124d33c57347097b7698861a06bb2a11af5c8b4a), block 12,076,201 |
| Point the name at it: the old resolver's role holders stop mattering | [`0xe836c357…`](https://sepolia.etherscan.io/tx/0xe836c357d07dceffb7884ea5786dfa9356350bcdb78dd091b6f2dc0890c00166), block 12,076,202 |
| Remove the operator | [`0x96bee140…`](https://sepolia.etherscan.io/tx/0x96bee140e9d1638a27dd84cb8b7047136c21181c3d4edbeecf5471b3bfe2071b), block 12,076,203 |
| Transfer the name to the device's PQ wallet | [`0x7a4a4f41…`](https://sepolia.etherscan.io/tx/0x7a4a4f41192d42bb39ea650b8258ee3f51a2001319dcc19f5dbf86cd7039eb60), block 12,076,204 |
| **The first change, signed on the ESP32:** the device showed `PQ WALLET · setText · name lifeboathw.eth · key pq.checked = …`, rebuilt the same hash as the contract, and signed after the BOOT press (leaf 4); our wallet only relayed it | [`0x6754badd…`](https://sepolia.etherscan.io/tx/0x6754badde76919fade2aa86b862e68fce98584cc30c15649b72a1101e71c88ac), block 12,076,271 |

- **After** (block 12,076,272): **protected**. Owner and resolver crew: the device's post-quantum wallet. The role lists for the resolver and the registry are both proven complete.
- **In the app:** Protect tab → **ENS name**. Connect the ESP32 (Web Serial) and the owner's wallet, run the Helm check, run the handover step by step, then change records. Each change is shown on the device and signed there.
- Script: [`ens-hw-handover.ts`](../scripts/src/ens-hw-handover.ts) · shared logic: [`packages/core/src/ens-protect.ts`](../packages/core/src/ens-protect.ts) · evidence: [`evidence/ens/hw-handover-lifeboathw.json`](../evidence/ens/hw-handover-lifeboathw.json)

## Contracts (Sepolia, ABIs from Sourcify in [`packages/core/abi/ens`](../packages/core/abi/ens))
Universal Resolver `0xeEeE…EeEe` · ETHRegistry `0xd4eb…a8b4` · ETHRegistrar `0xf633…a3d3` · PermissionedResolver impl `0x115e…2b2c` · VerifiableFactory `0xda70…2991` · UniversalHelper `0xd453…fe`. Role bits come from the verified `RegistryRolesLib` / `PermissionedResolverLib` sources.

## Run it
```bash
pnpm --filter @lifeboat/scripts helm lifeboatpq.eth      # any ENSv2 name
pnpm --filter @lifeboat/scripts ens-setup --label <new>  # a fresh messy name
pnpm --filter @lifeboat/scripts ens-handover
```

## Notes for the ENS team
- Public load-balanced Sepolia RPCs can answer from a backend that's a block behind, so a freshly regenerated token id can look missing for a few seconds. The scripts wait and retry.
- `TransferUnsafeWithMultipleAssignees` is a great safety net: it's the reason a naive "just transfer the name" can't silently leave a delegate behind.
