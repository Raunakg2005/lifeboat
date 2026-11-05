# Rescue paymaster: why this needs the ERC-8421 alt mempool

**The problem:** many exposed wallets hold tokens but no ETH. To escape to a post-quantum account they must pay gas, so first someone has to send them ETH. That's a second transaction, and it can be front-run or simply never happen. A sponsor would pay their gas, but only if it can check two things inside validation:
- that the wallet is a registered exposed account (shared state);
- that the wallet can repay in the token (a balance read through the token's upgradeable proxy).

The canonical mempool doesn't allow validation to read any of that. The alt mempool allows it for a **staked** sponsor.

## What the paymaster checks (VERIFY frame, PAYMENT scope)

Source: [`contracts/yul/src/RescuePaymaster.yul`](../contracts/yul/src/RescuePaymaster.yul) (517 bytes, Yul + `verbatim` for the frame opcodes).

1. The sender (`TXPARAM 0x02`) is in the paymaster's registry of exposed accounts.
2. The transaction's maximum cost (`TXPARAM 0x06`) is under the sponsor's cap (0.01 ETH).
3. `token.balanceOf(sender) >= fee`. The token is mock USDC behind an EIP-1967 proxy, like the real one.
4. **The very next frame repays:** it must be a SENDER frame (`FRAMEPARAM 0x02`) whose resolved target is the token (`0x00`), that isn't atomic-batched (`0x03` & 4), and whose data is `transfer(paymaster, ≥ fee)` (read with `FRAMEDATALOAD`). A later frame can't undo a repayment that sits outside any batch.
5. `APPROVE(0, 0, PAYMENT)`.

## The three-way admission demo (live, chain 1337, 5 Nov 2026 ~21:27 IST)

The same signed frame transaction from an exposed EOA with **0 ETH and 100 mUSDC**. Frames:
1. the EOA's own signature check
2. the paymaster's VERIFY
3. repay 1 mUSDC
4. sweep 99 mUSDC to the PQ LifeboatAccount

| Route | Answer (verbatim) |
|---|---|
| Canonical mempool (ethrex `eth_sendRawTransaction`) | ❌ `Frame transaction validation-prefix simulation failed: StorageReadNonSender` |
| Alt mempool, paymaster **unstaked** (gateway `eth_sendFrameTransaction`) | ❌ `unstaked payer accessed payer slot 0x…03` |
| Stake 0.012 ETH in `NaiveStakingRegistry` | ✅ `0x01b18ed6092834c43a2dd0ec6644b1d32d72df5d6f85d19d61a00ba83eb6e330`, registry reports `[0.012 ETH, delay 1, withdrawTime 0]` |
| Alt mempool, paymaster **staked** | ✅ **admitted**, included in block **404,050**, status 1: [`0x26462c90…4669f3`](https://explorer.altmempool.wtf/tx/0x26462c908a8e4002f73430dabf9844bb51fde79bf6d839210f58f57d394669f3?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc) |

After: the exposed EOA has 0 mUSDC (and still 0 ETH); the PQ account has 99 mUSDC; the paymaster has 1 mUSDC back.

Gas: 267,053 in total. The frames used 100, **22,683** (paymaster VERIFY), 25,533 and 15,533. Max cost was 0.00045 ETH, under the 0.01 ETH cap.

Raw evidence: [`evidence/ef/rescue.json`](../evidence/ef/rescue.json), [`rescue-dryrun.json`](../evidence/ef/rescue-dryrun.json), [`rescue-setup.json`](../evidence/ef/rescue-setup.json), screenshot [`explorer-rescue-sponsored.jpg`](../evidence/ef/explorer-rescue-sponsored.jpg).

## The sponsor can't be drained (dry-runs on the live devnet)

[`scripts/src/paymaster-guards.ts`](../scripts/src/paymaster-guards.ts) changes one thing at a time; the paymaster's VERIFY (frame 1) must refuse:

| Case | Paymaster approves? |
|---|---|
| control: repay the fee, then sweep | ✅ yes |
| repays less than the fee | ❌ no (frame 1 fails) |
| repays someone else | ❌ no |
| repay frame batched with a later frame (could be undone) | ❌ no |
| no repay frame: sweeps first | ❌ no |
| unregistered sender | ❌ no |

Evidence: [`evidence/ef/paymaster-guards.json`](../evidence/ef/paymaster-guards.json).

## Devnet notes (feedback for the EF team)

- `FRAMEPARAM` and `FRAMEDATALOAD` work on chain 1337 with the argument order (index on top for FRAMEPARAM; offset on top for FRAMEDATALOAD). The hegota-support helpers mark them as "not yet exercised on the devnet".
- `NaiveStakingRegistry.getDepositInfo(address)` returns three words (stake, unstake delay, withdraw time), not the five-field ERC-4337 struct.
- The sidecar's rejection text for unstaked storage access (`unstaked payer accessed payer slot …`) isn't mapped by `explainRejection` (it returns `UNKNOWN`).
- New storage slots cost about 98k of state gas here, so ordinary token mints need a gas limit of about 250k+.

## Run it

```bash
pnpm --filter @lifeboat/scripts rescue-setup
pnpm --filter @lifeboat/scripts rescue
pnpm --filter @lifeboat/scripts paymaster-guards
```
