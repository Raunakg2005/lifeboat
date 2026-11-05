// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// A post-quantum contract wallet for chains without EIP-8141 (Sepolia): it owns ENSv2 names and acts only
/// when given a WOTS+C signature. Anyone can relay `execute`; the relayer can't change what was signed.
///
/// The signature is checked by the same Yul WOTS+C core as the EIP-8141 LifeboatAccount, deployed on its own
/// (WotsHarness: calldata root ‖ pubSeed ‖ digest ‖ witness → (ok, gas)).
///
/// Leaves are one-time: each is marked used *before* any external call, and the witness must be for that leaf.
/// ERC-1271 uses approved hashes, so a WOTS key never signs off-chain messages it could be tricked into reusing.
contract LifeboatPQWallet {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    uint256 public constant LEAVES = 256;
    bytes32 public immutable root;
    bytes32 public immutable pubSeed;
    address public immutable verifier;

    /// bit i set = leaf i used
    uint256 public usedLeaves;
    mapping(bytes32 => bool) public approvedHashes;

    event Executed(uint256 indexed leaf, bytes32 digest, uint256 calls);
    event HashApproved(bytes32 indexed hash);

    error LeafOutOfRange(uint256 leaf);
    error LeafUsed(uint256 leaf);
    error WitnessLeafMismatch(uint256 leaf, uint256 witnessLeaf);
    error Expired(uint256 deadline);
    error BadSignature();
    error CallFailed(uint256 index, bytes reason);
    error OnlySelf();

    constructor(bytes32 root_, bytes32 pubSeed_, address verifier_) {
        root = root_;
        pubSeed = pubSeed_;
        verifier = verifier_;
    }

    /// What the WOTS+C key signs (passed to the verifier as its "sigHash").
    function digest(uint256 leaf, uint256 deadline, Call[] calldata calls) public view returns (bytes32) {
        return keccak256(abi.encode("LIFEBOAT_PQ_V1", block.chainid, address(this), leaf, deadline, keccak256(abi.encode(calls))));
    }

    function isLeafUsed(uint256 leaf) external view returns (bool) {
        return leaf < LEAVES && (usedLeaves >> leaf) & 1 == 1;
    }

    function execute(uint256 leaf, uint256 deadline, Call[] calldata calls, bytes calldata witness) external payable {
        if (leaf >= LEAVES) revert LeafOutOfRange(leaf);
        if (block.timestamp > deadline) revert Expired(deadline);
        if ((usedLeaves >> leaf) & 1 == 1) revert LeafUsed(leaf);
        if (witness.length != 2336) revert BadSignature();
        uint256 witnessLeaf = uint256(bytes32(witness[0:32])) >> 32;
        if (witnessLeaf != leaf) revert WitnessLeafMismatch(leaf, witnessLeaf);
        usedLeaves |= 1 << leaf; // before any external call

        bytes32 d = digest(leaf, deadline, calls);
        (bool ok, bytes memory ret) = verifier.staticcall(abi.encodePacked(root, pubSeed, d, witness));
        if (!ok || ret.length < 32 || abi.decode(ret, (uint256)) != 1) revert BadSignature();

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory reason) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) revert CallFailed(i, reason);
        }
        emit Executed(leaf, d, calls.length);
    }

    /// Called through `execute` to let contracts check an ERC-1271 signature from this wallet.
    function approveHash(bytes32 hash) external {
        if (msg.sender != address(this)) revert OnlySelf();
        approvedHashes[hash] = true;
        emit HashApproved(hash);
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        return approvedHashes[hash] ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    // ENSv2 registries are ERC-1155 and call these on every move of the name's token (including role changes,
    // which regenerate the token id), so they stay stateless.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x4e2312e0 || id == 0x1626ba7e;
    }

    receive() external payable {}
}
