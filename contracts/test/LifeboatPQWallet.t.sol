// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LifeboatPQWallet} from "../src/LifeboatPQWallet.sol";

/// Real WOTS+C signatures made by the TypeScript signer (scripts/src/gen-wallet-vectors.ts) against the
/// Yul verifier core, through the wallet that will own ENS names on Sepolia.
contract LifeboatPQWalletTest is Test {
    LifeboatPQWallet wallet;
    string json;
    address constant WALLET = 0x0000000000000000000000000000000000001ce0;

    function setUp() public {
        bytes memory initcode = vm.parseBytes(vm.readFile("yul/out/WotsHarness.initcode.hex"));
        address verifier;
        assembly {
            verifier := create(0, add(initcode, 0x20), mload(initcode))
        }
        json = vm.readFile("test/vectors/wallet.json");
        bytes32 root = vm.parseJsonBytes32(json, ".root");
        bytes32 pubSeed = vm.parseJsonBytes32(json, ".pubSeed");
        deployCodeTo("LifeboatPQWallet.sol:LifeboatPQWallet", abi.encode(root, pubSeed, verifier), WALLET);
        wallet = LifeboatPQWallet(payable(WALLET));
        vm.deal(WALLET, 1 ether);
    }

    function vec(uint256 i) internal view returns (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness, bytes32 d) {
        string memory p = string.concat(".cases[", vm.toString(i), "]");
        leaf = vm.parseJsonUint(json, string.concat(p, ".leaf"));
        deadline = vm.parseJsonUint(json, string.concat(p, ".deadline"));
        calls = new LifeboatPQWallet.Call[](1);
        calls[0] = LifeboatPQWallet.Call(vm.parseJsonAddress(json, string.concat(p, ".recipient")), vm.parseJsonUint(json, string.concat(p, ".value")), "");
        witness = vm.parseJsonBytes(json, string.concat(p, ".witness"));
        d = vm.parseJsonBytes32(json, string.concat(p, ".digest"));
    }

    function test_digestMatchesTypeScript() public view {
        (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls,, bytes32 d) = vec(0);
        assertEq(wallet.digest(leaf, deadline, calls), d);
    }

    function test_executeWithValidSignature() public {
        (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness,) = vec(0);
        vm.prank(makeAddr("anyRelayer"));
        wallet.execute(leaf, deadline, calls, witness);
        assertEq(calls[0].target.balance, 1000);
        assertTrue(wallet.isLeafUsed(leaf));
    }

    function test_replayFails() public {
        (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness,) = vec(0);
        wallet.execute(leaf, deadline, calls, witness);
        vm.expectRevert(abi.encodeWithSelector(LifeboatPQWallet.LeafUsed.selector, leaf));
        wallet.execute(leaf, deadline, calls, witness);
    }

    function test_relayerCannotChangeCalls() public {
        (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness,) = vec(0);
        calls[0].target = makeAddr("thief");
        vm.expectRevert(LifeboatPQWallet.BadSignature.selector);
        wallet.execute(leaf, deadline, calls, witness);
        assertFalse(wallet.isLeafUsed(leaf)); // the revert rolls the mark back too
    }

    function test_witnessMustBeForTheMarkedLeaf() public {
        (, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness,) = vec(0); // signed with leaf 3
        vm.expectRevert(abi.encodeWithSelector(LifeboatPQWallet.WitnessLeafMismatch.selector, 4, 3));
        wallet.execute(4, deadline, calls, witness);
    }

    function test_expiredDeadline() public {
        (uint256 leaf, uint256 deadline, LifeboatPQWallet.Call[] memory calls, bytes memory witness,) = vec(1);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(LifeboatPQWallet.Expired.selector, deadline));
        wallet.execute(leaf, deadline, calls, witness);
    }

    function test_erc1155HooksAndInterfaces() public view {
        assertEq(wallet.onERC1155Received(address(0), address(0), 0, 1, ""), bytes4(0xf23a6e61));
        assertEq(wallet.onERC1155BatchReceived(address(0), address(0), new uint256[](0), new uint256[](0), ""), bytes4(0xbc197c81));
        assertTrue(wallet.supportsInterface(0x4e2312e0));
        assertEq(wallet.isValidSignature(keccak256("x"), ""), bytes4(0xffffffff));
    }

    function test_onlySelfApprovesHashes() public {
        vm.expectRevert(LifeboatPQWallet.OnlySelf.selector);
        wallet.approveHash(keccak256("x"));
    }
}
