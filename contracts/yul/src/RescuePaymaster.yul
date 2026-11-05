// Lifeboat rescue paymaster for EIP-8141 frame transactions (ethrex eip8141-tracer, chain 1337).
//
// Pays gas for registered exposed wallets that hold a token (mock USDC) but no ETH, so they can sweep to a
// post-quantum account. It is repaid in the token inside the same transaction.
//
// Why it needs the ERC-8421 alt mempool and a stake: its VERIFY frame reads shared state (its own registry of
// exposed accounts, and the token's balance through an upgradeable proxy). The canonical mempool only lets
// validation read the sender's own storage; the alt mempool allows it for a staked entity.
//
// Storage: 0 owner, 1 token, 2 fee (token units), 3 max ETH cost sponsored per tx,
//          keccak(account ‖ 4) = 1 if the account is registered as exposed.
// Init code expects token ‖ fee ‖ maxCost (96 bytes) appended; the deployer becomes owner.
object "RescuePaymaster" {
    code {
        codecopy(0, sub(codesize(), 96), 96)
        sstore(0, caller())
        sstore(1, mload(0))
        sstore(2, mload(32))
        sstore(3, mload(64))
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            if eq(caller(), 0xaa) { verifyPayment() }

            switch shr(224, calldataload(0))
            case 0x0a2719ab { // setEligible(address account, bool ok)
                onlyOwner()
                sstore(eligibleSlot(calldataload(4)), iszero(iszero(calldataload(36))))
            }
            case 0xacd2ebf2 { // setConfig(address token, uint256 fee, uint256 maxCost)
                onlyOwner()
                sstore(1, calldataload(4))
                sstore(2, calldataload(36))
                sstore(3, calldataload(68))
            }
            case 0x0565bb67 { // exec(address to, uint256 value, bytes data): stake, unstake, withdraw
                onlyOwner()
                let off := add(4, calldataload(68))
                let len := calldataload(off)
                calldatacopy(0, add(off, 32), len)
                if iszero(call(gas(), calldataload(4), calldataload(36), 0, len, 0, 0)) {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
            case 0x8da5cb5b { ret(sload(0)) } // owner()
            case 0xfc0c546a { ret(sload(1)) } // token()
            case 0xddca3f43 { ret(sload(2)) } // fee()
            case 0x13517fea { ret(sload(3)) } // maxCost()
            case 0x66e305fd { ret(sload(eligibleSlot(calldataload(4)))) } // isEligible(address)
            default { } // plain ETH top-ups
            stop()

            function ret(v) {
                mstore(0, v)
                return(0, 32)
            }
            function onlyOwner() { if iszero(eq(caller(), sload(0))) { revert(0, 0) } }
            function eligibleSlot(account) -> s {
                mstore(0, and(account, 0xffffffffffffffffffffffffffffffffffffffff))
                mstore(0x20, 4)
                s := keccak256(0, 0x40)
            }

            // ---- EIP-8141 opcodes ----
            function txparam(p) -> v { v := verbatim_1i_1o(hex"b0", p) }
            function frameparam(frameIdx, p) -> v { v := verbatim_2i_1o(hex"b3", frameIdx, p) }
            function framedataload(off, frameIdx) -> v { v := verbatim_2i_1o(hex"b1", off, frameIdx) }
            function approve(off, len, scope) { verbatim_3i_0o(hex"aa", off, len, scope) }

            // VERIFY frame with PAYMENT scope.
            function verifyPayment() {
                let sender := txparam(0x02)
                // 1. only registered exposed accounts (shared state: the paymaster's own registry)
                if iszero(sload(eligibleSlot(sender))) { revert(0, 0) }
                // 2. cap what one rescue can cost the sponsor
                if gt(txparam(0x06), sload(3)) { revert(0, 0) }
                let token := sload(1)
                let fee := sload(2)
                // 3. the sender can repay: token.balanceOf(sender) >= fee (read through the token's proxy)
                mstore(0, shl(224, 0x70a08231))
                mstore(4, sender)
                if iszero(staticcall(gas(), token, 0, 0x24, 0, 0x20)) { revert(0, 0) }
                if lt(mload(0), fee) { revert(0, 0) }
                // 4. the very next frame repays: SENDER mode, target = token, transfer(this, >= fee),
                //    and not atomic-batched, so no later frame can undo the repayment
                let i := add(txparam(0x0a), 1)
                if iszero(lt(i, txparam(0x09))) { revert(0, 0) }
                if iszero(eq(frameparam(i, 0x02), 2)) { revert(0, 0) }
                if iszero(eq(frameparam(i, 0x00), token)) { revert(0, 0) }
                if and(frameparam(i, 0x03), 4) { revert(0, 0) }
                if lt(frameparam(i, 0x04), 68) { revert(0, 0) }
                if iszero(eq(shr(224, framedataload(0, i)), 0xa9059cbb)) { revert(0, 0) }
                if iszero(eq(framedataload(4, i), address())) { revert(0, 0) }
                if lt(framedataload(36, i), fee) { revert(0, 0) }
                approve(0, 0, 1)
                stop()
            }
        }
    }
}
