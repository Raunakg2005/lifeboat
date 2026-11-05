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

// @@WOTS_WALK@@
            // ---- end of WOTS+C verifier core ----
