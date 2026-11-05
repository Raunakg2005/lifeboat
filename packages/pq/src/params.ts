/**
 * Lifeboat WOTS+C parameters. The Yul verifier (contracts/yul/wots_core.yul) hard-codes the same values;
 * change both together.
 *
 * WOTS+C (Kudinov, Hülsing et al.): instead of checksum chains, the signer grinds a counter until the
 * message digest's base-w digits add up to exactly TARGET_SUM. Any other digest with the same sum has at
 * least one smaller digit, so a single signature can't be pushed forward into a forgery, and the verifier
 * always walks exactly LEN * MAX_STEP - TARGET_SUM hash steps (constant gas).
 */
export const N = 32; // bytes per hash value (keccak256)
export const W = 16; // Winternitz parameter: 4-bit digits
export const LEN = 64; // 256-bit digest / 4 bits per digit
export const MAX_STEP = W - 1; // 15 steps from secret to public end of each chain
export const TARGET_SUM = 560; // required digit sum of the digest
export const VERIFY_STEPS = LEN * MAX_STEP - TARGET_SUM; // 400 chain hashes per verification

export const TREE_HEIGHT = 8; // Merkle tree of one-time leaves
export const LEAVES = 1 << TREE_HEIGHT; // 256 signatures per key

/** Witness = header word (leaf << 32 | counter) + 64 chain values + TREE_HEIGHT auth-path siblings. */
export const WITNESS_WORDS = 1 + LEN + TREE_HEIGHT;
export const WITNESS_BYTES = WITNESS_WORDS * 32; // 2336

/** Address-word types (byte 30 of the 32-byte tweak). */
export const T_CHAIN = 0;
export const T_LEAF = 1;
export const T_NODE = 2;
export const T_MSG = 3;
export const T_SK = 4; // secret derivation, never on-chain
