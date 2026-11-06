// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Safe 1.4.1 views the guard needs.
interface ISafeView {
    function nonce() external view returns (uint256);
    function domainSeparator() external view returns (bytes32);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
    function checkSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures) external view;
}

/// Quantum Guard: a post-quantum co-signer for a Safe, with no funds moved.
///
/// On Q-Day an attacker can forge every owner's ECDSA signature, so the threshold stops protecting anything.
/// Installed as the Safe's transaction guard AND its fallback handler, this contract adds one more signer that a
/// quantum computer can't forge: a WOTS+C key (hash-based, the same Yul verifier as Lifeboat's EIP-8141 account).
///
///   * Every Safe transaction must carry, after the owners' signatures, a 2,336-byte WOTS+C witness over that exact
///     safeTxHash. Each one-time leaf is spent once (bitmap), before anything else happens.
///   * ERC-1271: the Safe's own signature check (Permit2, CoW orders, Seaport…) also needs the PQ key. A message is
///     valid only if the PQ key approved it AND the owners signed it, which closes the off-chain signature bypass
///     that a transaction guard alone leaves open.
///   * The PQ key can be rotated with a PQ signature (its 256 leaves run out).
///   * Lost-key recovery: the owners alone can start a recovery (no PQ signature), which completes only after a
///     timelock. The PQ key can cancel it at any time before then. A quantum attacker who forged the owners can
///     start one too, so the PQ key holder must watch for RecoveryStarted (Lifeboat's Monitor alerts on it).
///
/// Prior art, credited: Safe Research's co-signer guard pattern. What's new here: a hash-based co-signer with
/// on-chain one-time-key accounting, and the ERC-1271 path covered too.
contract QuantumGuard {
    struct SafeTx {
        address to;
        uint256 value;
        bytes data;
        uint8 operation;
        uint256 safeTxGas;
        uint256 baseGas;
        uint256 gasPrice;
        address gasToken;
        address refundReceiver;
        bytes signatures;
        address msgSender;
    }

    uint256 public constant LEAVES = 256;
    uint256 public constant WITNESS_LENGTH = 2336;
    uint8 public constant KIND_TX = 0;
    uint8 public constant KIND_MESSAGE = 1;
    uint8 public constant KIND_ROTATE = 2;
    uint8 public constant KIND_CANCEL_RECOVERY = 3;
    bytes32 internal constant SAFE_MSG_TYPEHASH = keccak256("SafeMessage(bytes message)");

    address public immutable safe;
    address public immutable verifier;
    /// seconds between startRecovery and finishRecovery (7 days or more in production)
    uint256 public immutable recoveryDelay;
    bytes32 public root;
    bytes32 public pubSeed;
    /// bit i set = leaf i spent
    uint256 public usedLeaves;
    /// Safe message hashes (EIP-712, as the Safe's fallback handler computes them) the PQ key approved
    mapping(bytes32 => bool) public approvedMessages;
    /// lost-key recovery: attempt number, when it can complete (0 = none pending), and whether one completed
    uint256 public recoveryNonce;
    uint256 public recoveryReadyAt;
    bool public recovered;

    event PQCoSigned(bytes32 indexed safeTxHash, uint256 leaf);
    event MessageApproved(bytes32 indexed safeMessageHash, uint256 leaf);
    event KeyRotated(bytes32 indexed root, uint256 leaf);
    event RecoveryStarted(uint256 indexed nonce, uint256 readyAt);
    event RecoveryCancelled(uint256 indexed nonce, uint256 leaf);
    event Recovered(uint256 indexed nonce);

    error NotTheSafe();
    error MissingPQSignature();
    error LeafOutOfRange(uint256 leaf);
    error LeafUsed(uint256 leaf);
    error BadPQSignature();
    error NoRecovery();
    error RecoveryNotReady(uint256 readyAt);

    constructor(address safe_, address verifier_, bytes32 root_, bytes32 pubSeed_, uint256 recoveryDelay_) {
        safe = safe_;
        verifier = verifier_;
        recoveryDelay = recoveryDelay_;
        root = root_;
        pubSeed = pubSeed_;
    }

    /// What the WOTS+C key signs for each kind of approval.
    function digest(uint8 kind, bytes32 h) public view returns (bytes32) {
        return keccak256(abi.encode("LIFEBOAT_QUANTUM_GUARD_V1", kind, block.chainid, address(this), safe, h));
    }

    function isLeafUsed(uint256 leaf) external view returns (bool) {
        return leaf < LEAVES && (usedLeaves >> leaf) & 1 == 1;
    }

    /// Spends the witness's leaf, then checks the WOTS+C signature over digest(kind, h). Reverts on anything wrong.
    function _spendAndVerify(uint8 kind, bytes32 h, bytes memory w) internal returns (uint256 leaf) {
        if (w.length != WITNESS_LENGTH) revert MissingPQSignature();
        assembly ("memory-safe") {
            leaf := shr(32, mload(add(w, 32)))
        }
        if (leaf >= LEAVES) revert LeafOutOfRange(leaf);
        if ((usedLeaves >> leaf) & 1 == 1) revert LeafUsed(leaf);
        usedLeaves |= 1 << leaf;
        (bool ok, bytes memory ret) = verifier.staticcall(abi.encodePacked(root, pubSeed, digest(kind, h), w));
        if (!ok || ret.length < 32 || abi.decode(ret, (uint256)) != 1) revert BadPQSignature();
    }

    function _tail(bytes memory b, uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        assembly ("memory-safe") {
            mcopy(add(out, 32), add(add(b, 32), sub(mload(b), n)), n)
        }
    }

    // ------------------------------------------------------------------ transaction guard (Safe 1.4.1)

    /// Called by the Safe inside execTransaction, after the owners' signatures checked out and the nonce moved on.
    function checkTransaction(address, uint256, bytes calldata, uint8, uint256, uint256, uint256, address, address payable, bytes calldata, address) external {
        if (msg.sender != safe) revert NotTheSafe();
        // the arguments are one ABI tuple: decode them as a struct (keeps the stack small)
        SafeTx memory t = abi.decode(bytes.concat(bytes32(uint256(32)), msg.data[4:]), (SafeTx));
        if (recovered) return; // after a completed recovery the owners act alone (to remove or replace this guard)
        // starting or finishing a recovery needs the owners only: the timelock and the PQ veto protect it
        if (t.to == address(this) && t.value == 0 && t.operation == 0 && t.data.length == 4) {
            bytes4 sel = bytes4(t.data);
            if (sel == this.startRecovery.selector || sel == this.finishRecovery.selector) return;
        }
        if (t.signatures.length < WITNESS_LENGTH + 65) revert MissingPQSignature();
        bytes32 safeTxHash = ISafeView(safe).getTransactionHash(
            t.to, t.value, t.data, t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, ISafeView(safe).nonce() - 1
        );
        uint256 leaf = _spendAndVerify(KIND_TX, safeTxHash, _tail(t.signatures, WITNESS_LENGTH));
        emit PQCoSigned(safeTxHash, leaf);
    }

    function checkAfterExecution(bytes32, bool) external {}

    // ------------------------------------------------------------------ ERC-1271 (fallback handler)

    /// The Safe's EIP-712 message hash for `dataHash`, exactly as Safe's CompatibilityFallbackHandler computes it.
    function messageData(bytes32 dataHash) public view returns (bytes memory) {
        bytes32 safeMessageHash = keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(dataHash))));
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), ISafeView(safe).domainSeparator(), safeMessageHash);
    }

    /// The PQ key approves one Safe message. Anyone can relay it: the witness is the authorization.
    function approveMessage(bytes32 dataHash, bytes calldata witness) external {
        bytes32 h = keccak256(messageData(dataHash));
        uint256 leaf = _spendAndVerify(KIND_MESSAGE, h, witness);
        approvedMessages[h] = true;
        emit MessageApproved(h, leaf);
    }

    /// Reached through the Safe's fallback (msg.sender = the Safe): valid only with the PQ approval AND the owners'
    /// signatures over the same message.
    function isValidSignature(bytes32 dataHash, bytes calldata signature) external view returns (bytes4) {
        if (msg.sender != safe || signature.length == 0) return 0xffffffff;
        bytes memory data = messageData(dataHash);
        bytes32 h = keccak256(data);
        if (!recovered && !approvedMessages[h]) return 0xffffffff;
        try ISafeView(safe).checkSignatures(h, data, signature) {
            return 0x1626ba7e;
        } catch {
            return 0xffffffff;
        }
    }

    // ------------------------------------------------------------------ key rotation

    /// Moves the guard to a fresh WOTS+C key (256 new leaves), authorized by the current key.
    function rotate(bytes32 newRoot, bytes32 newPubSeed, bytes calldata witness) external {
        uint256 leaf = _spendAndVerify(KIND_ROTATE, keccak256(abi.encode(newRoot, newPubSeed)), witness);
        root = newRoot;
        pubSeed = newPubSeed;
        usedLeaves = 0;
        emit KeyRotated(newRoot, leaf);
    }

    // ------------------------------------------------------------------ lost-key recovery

    /// Only a Safe transaction can call these: it calls with exactly the selector, while a call that reaches the
    /// guard through the Safe's fallback carries the original caller appended (20 more bytes).
    function _fromSafeTx() internal view {
        if (msg.sender != safe || msg.data.length != 4) revert NotTheSafe();
    }

    function startRecovery() external {
        _fromSafeTx();
        recoveryNonce++;
        recoveryReadyAt = block.timestamp + recoveryDelay;
        emit RecoveryStarted(recoveryNonce, recoveryReadyAt);
    }

    /// The PQ key vetoes the pending recovery. Anyone can relay it: the witness is the authorization.
    function cancelRecovery(bytes calldata witness) external {
        if (recoveryReadyAt == 0) revert NoRecovery();
        uint256 leaf = _spendAndVerify(KIND_CANCEL_RECOVERY, keccak256(abi.encode("CANCEL_RECOVERY", recoveryNonce)), witness);
        recoveryReadyAt = 0;
        emit RecoveryCancelled(recoveryNonce, leaf);
    }

    function finishRecovery() external {
        _fromSafeTx();
        if (recoveryReadyAt == 0) revert NoRecovery();
        if (block.timestamp < recoveryReadyAt) revert RecoveryNotReady(recoveryReadyAt);
        recovered = true;
        recoveryReadyAt = 0;
        emit Recovered(recoveryNonce);
    }

    // ------------------------------------------------------------------ fallback-handler duties

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }

    /// The Safe 1.4.1 Guard interface id (checkTransaction ^ checkAfterExecution).
    function guardInterfaceId() public pure returns (bytes4) {
        return this.checkTransaction.selector ^ this.checkAfterExecution.selector;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == guardInterfaceId() || id == 0x1626ba7e || id == 0x150b7a02 || id == 0x4e2312e0;
    }
}
