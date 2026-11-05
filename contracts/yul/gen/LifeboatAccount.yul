// Lifeboat post-quantum account for EIP-8141 frame transactions (ethrex eip8141-tracer, chain 1337).
// GENERATED from contracts/yul/LifeboatAccount.yul.tmpl + wots_core.yul by tools/gen-yul.mjs. Edit those.
//
// Storage: slot 0 = Merkle root of the WOTS+C key, slot 1 = pubSeed, slot 2 = lowest usable leaf + 1.
// Init code expects root ‖ pubSeed (64 bytes) appended after it.
//
// Dispatch on CALLER:
//   0xaa (frame entry point) -> VERIFY: check the WOTS+C witness in signature entry 0, then APPROVE.
//   the account itself      -> execute a SENDER frame: data = leaf ‖ to ‖ value ‖ calldata.
//   anyone else             -> accept (plain ETH transfers).
object "LifeboatAccount" {
    code {
        let args := sub(codesize(), 64)
        codecopy(0, args, 64)
        sstore(0, mload(0))
        sstore(1, mload(32))
        sstore(2, 1) // non-zero from the start, so later writes are cheap
        let size := datasize("runtime")
        datacopy(0, dataoffset("runtime"), size)
        return(0, size)
    }
    object "runtime" {
        code {
            if eq(caller(), 0xaa) { verifyFrame() }
            if eq(caller(), address()) {
                execute()
                stop()
            }
            stop()

            // ---- EIP-8141 opcodes (not known to solc, so emitted with verbatim) ----
            function sigparam(sigIdx, param) -> v { v := verbatim_2i_1o(hex"b4", sigIdx, param) }
            function sigdatacopy(mem, dataOff, len, sigIdx) { verbatim_4i_0o(hex"b5", mem, dataOff, len, sigIdx) }
            function txparam(param) -> v { v := verbatim_1i_1o(hex"b0", param) }
            function approve(off, len, scope) { verbatim_3i_0o(hex"aa", off, len, scope) }

            // VERIFY frame. Banned here: ORIGIN, TIMESTAMP, NUMBER, BALANCE, SELFBALANCE, TLOAD, TSTORE;
            // only this account's own storage is read.
            function verifyFrame() {
                if sigparam(0, 0x01) { revert(0, 0) } // entry 0 must be ARBITRARY (scheme 0)
                if iszero(eq(sigparam(0, 0x03), 2336)) { revert(0, 0) } // exact length, so no padding games
                let w := 0x1000
                sigdatacopy(w, 0, 2336, 0)
                // a leaf below the floor was already used by a landed transaction
                if lt(add(shr(32, mload(w)), 1), sload(2)) { revert(0, 0) }
                if iszero(wots_verify(w, sload(0), sload(1), txparam(0x08))) { revert(0, 0) }
                // approval scope comes from the (signed) VERIFY frame data: 1 byte, default 3 = execution + payment
                let scope := 3
                if calldatasize() { scope := shr(248, calldataload(0)) }
                if or(iszero(scope), gt(scope, 3)) { revert(0, 0) }
                approve(0, 0, scope)
                stop()
            }

            // SENDER frame, run as the account itself. Raises the leaf floor past the leaf this
            // transaction used, so an old (or reused-and-forged) leaf can never pass VERIFY again.
            function execute() {
                if lt(calldatasize(), 96) { revert(0, 0) }
                let leaf := calldataload(0)
                if iszero(lt(leaf, 256)) { revert(0, 0) }
                if gt(add(leaf, 2), sload(2)) { sstore(2, add(leaf, 2)) }
                let to := calldataload(32)
                if to {
                    let len := sub(calldatasize(), 96)
                    calldatacopy(0, 96, len)
                    if iszero(call(gas(), to, calldataload(64), 0, len, 0, 0)) {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                }
            }

            // ---- WOTS+C verifier core (shared by LifeboatAccount and WotsHarness; generated into yul/gen/) ----
            // Must match packages/pq/src/params.ts and hash.ts:
            //   LEN 64, MAX_STEP 15, TARGET_SUM 560, TREE_HEIGHT 8, WITNESS_BYTES 2336.
            //   tweak = pubSeed[0:24] | idx << 32 | a << 24 | b << 16 | type << 8
            // Memory: 0x00-0x7f scratch, 0x100-0x91f leaf-hash buffer (tweak + 64 chain ends),
            //         witness at `w` (callers use 0x1000).
            function wots_verify(w, root, pubSeed, sigHash) -> ok {
                let header := mload(w)
                if shr(64, header) { leave } // bytes 0..23 of the header must be zero
                let leaf := shr(32, header)
                if iszero(lt(leaf, 256)) { leave }
                let counter := and(header, 0xffffffff)

                let base := and(pubSeed, not(0xffffffffffffffff)) // pubSeed[0:24]
                let leafAdrs := or(base, shl(32, leaf))

                // digest = keccak(tweak(leaf,0,0,MSG) ‖ root ‖ sigHash ‖ counter)
                mstore(0x00, or(leafAdrs, 0x300))
                mstore(0x20, root)
                mstore(0x40, sigHash)
                mstore(0x60, counter)
                let digest := keccak256(0x00, 0x80)

                // the digits must add up to exactly TARGET_SUM (this replaces checksum chains).
                // SWAR: add nibble pairs into bytes, bytes into 16-bit lanes, then all lanes with one multiply.
                {
                    let m4 := 0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f
                    let m8 := 0x00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff
                    let s := add(and(digest, m4), and(shr(4, digest), m4))
                    s := add(and(s, m8), and(shr(8, s), m8))
                    if iszero(eq(shr(240, mul(s, 0x0001000100010001000100010001000100010001000100010001000100010001)), 560)) { leave }
                }

                // walk each chain from its revealed position to the public end (400 hashes in total).
                // Memory 0x00 = chain tweak (byte 29 = step), 0x20 = running value; wots_walk is unrolled.
                for { let k := 0 } lt(k, 64) { k := add(k, 1) } {
                    mstore(0x00, or(leafAdrs, shl(24, k)))
                    mstore(0x20, mload(add(w, shl(5, add(k, 1)))))
                    wots_walk(and(shr(sub(252, shl(2, k)), digest), 0xf))
                    mstore(add(0x120, shl(5, k)), mload(0x20))
                }

                // leaf = keccak(tweak(leaf,0,0,LEAF) ‖ pk_0 ‖ … ‖ pk_63)
                mstore(0x100, or(leafAdrs, 0x100))
                let node := keccak256(0x100, 0x820)

                // index-bound Merkle path: the leaf position picks left/right and goes into every node tweak
                let idx := leaf
                for { let l := 1 } lt(l, 9) { l := add(l, 1) } {
                    let sib := mload(add(w, shl(5, add(64, l))))
                    let parent := shr(1, idx)
                    mstore(0x00, or(or(base, shl(32, parent)), or(shl(24, l), 0x200)))
                    switch and(idx, 1)
                    case 0 {
                        mstore(0x20, node)
                        mstore(0x40, sib)
                    }
                    default {
                        mstore(0x20, sib)
                        mstore(0x40, node)
                    }
                    node := keccak256(0x00, 0x60)
                    idx := parent
                }
                ok := eq(node, root)
            }

            // GENERATED by tools/gen-yul.mjs: applies chain steps d..14 (byte 29 of the tweak = step index).
            function wots_walk(d) {
                switch lt(d, 8)
                case 0 {
                    switch lt(d, 12)
                    case 0 {
                        switch lt(d, 14)
                        case 0 {
                            switch lt(d, 15)
                            case 0 {
                                // d = 15: already at the public end
                            }
                            default {
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                        default {
                            switch lt(d, 13)
                            case 0 {
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                    }
                    default {
                        switch lt(d, 10)
                        case 0 {
                            switch lt(d, 11)
                            case 0 {
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                        default {
                            switch lt(d, 9)
                            case 0 {
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                    }
                }
                default {
                    switch lt(d, 4)
                    case 0 {
                        switch lt(d, 6)
                        case 0 {
                            switch lt(d, 7)
                            case 0 {
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                        default {
                            switch lt(d, 5)
                            case 0 {
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 4) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                    }
                    default {
                        switch lt(d, 2)
                        case 0 {
                            switch lt(d, 3)
                            case 0 {
                                mstore8(0x1d, 3) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 4) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 2) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 3) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 4) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                        default {
                            switch lt(d, 1)
                            case 0 {
                                mstore8(0x1d, 1) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 2) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 3) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 4) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                            default {
                                mstore8(0x1d, 0) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 1) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 2) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 3) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 4) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 5) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 6) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 7) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 8) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 9) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 10) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 11) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 12) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 13) mstore(0x20, keccak256(0x00, 0x40))
                                mstore8(0x1d, 14) mstore(0x20, keccak256(0x00, 0x40))
                            }
                        }
                    }
                }
            }
            // ---- end of WOTS+C verifier core ----
        }
    }
}
