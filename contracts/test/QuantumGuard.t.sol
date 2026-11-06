// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {QuantumGuard} from "../src/QuantumGuard.sol";
import {QuantumGuardFactory} from "../src/QuantumGuardFactory.sol";

/// A minimal Safe with Safe 1.4.1's order of events in execTransaction (owners checked, nonce moves on, then the
/// guard), the same EIP-712 hashes, and a fallback that forwards with the caller appended. The owners' check is not
/// what's under test: any signature blob of at least 65 bytes passes, like a forged 1-of-1 on Q-Day.
contract MockSafe {
    bytes32 constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 constant SAFE_TX_TYPEHASH =
        keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)");

    uint256 public nonce;
    address public guard;
    address public fallbackHandler;

    function setGuard(address g) external {
        guard = g;
    }

    function setFallbackHandler(address h) external {
        fallbackHandler = h;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

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
    ) public view returns (bytes32) {
        bytes32 h = keccak256(bytes.concat(abi.encode(SAFE_TX_TYPEHASH, to, value, keccak256(data), operation, safeTxGas), abi.encode(baseGas, gasPrice, gasToken, refundReceiver, _nonce)));
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), h));
    }

    function checkSignatures(bytes32, bytes memory, bytes memory signatures) public pure {
        require(signatures.length >= 65, "GS020");
    }

    function execTransaction(address to, uint256 value, bytes calldata data, bytes calldata signatures) external returns (bool ok) {
        checkSignatures(bytes32(0), "", signatures);
        nonce++;
        if (guard != address(0)) QuantumGuard(guard).checkTransaction(to, value, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures, msg.sender);
        bytes memory ret;
        (ok, ret) = to.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    fallback() external {
        (bool ok, bytes memory ret) = fallbackHandler.call(bytes.concat(msg.data, bytes20(msg.sender)));
        require(ok, "handler reverted");
        assembly ("memory-safe") {
            return(add(ret, 32), mload(ret))
        }
    }

    receive() external payable {}
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// Real WOTS+C co-signatures from the TypeScript signer (scripts/src/gen-guard-vectors.ts), verified by the same Yul
/// core as the EIP-8141 account.
contract QuantumGuardTest is Test {
    MockSafe safe;
    QuantumGuard guard;
    string json;
    bytes ecdsa = new bytes(65); // stands in for the owners' (forgeable) ECDSA signatures
    address verifier;
    uint256 delay;

    function setUp() public {
        bytes memory initcode = vm.parseBytes(vm.readFile("yul/out/WotsHarness.initcode.hex"));
        address v;
        assembly {
            v := create(0, add(initcode, 0x20), mload(initcode))
        }
        verifier = v;
        json = vm.readFile("test/vectors/guard.json");
        address safeAddr = vm.parseJsonAddress(json, ".safe");
        address guardAddr = vm.parseJsonAddress(json, ".guard");
        deployCodeTo("QuantumGuard.t.sol:MockSafe", safeAddr);
        delay = vm.parseJsonUint(json, ".recoveryDelay");
        deployCodeTo("QuantumGuard.sol:QuantumGuard", abi.encode(safeAddr, verifier, vm.parseJsonBytes32(json, ".root"), vm.parseJsonBytes32(json, ".pubSeed"), delay), guardAddr);
        safe = MockSafe(payable(safeAddr));
        guard = QuantumGuard(guardAddr);
        vm.deal(safeAddr, 1 ether);
        safe.setGuard(guardAddr);
    }

    function txWitness(uint256 i) internal view returns (bytes memory) {
        return vm.parseJsonBytes(json, string.concat(".tx[", vm.toString(i), "].witness"));
    }

    function exec(bytes memory signatures) internal {
        safe.execTransaction(vm.parseJsonAddress(json, ".recipient"), 1000, "", signatures);
    }

    function test_guardInterfaceIdMatchesSafe141() public view {
        assertEq(guard.guardInterfaceId(), bytes4(0xe6d7a83a));
        assertTrue(guard.supportsInterface(0xe6d7a83a));
        assertTrue(guard.supportsInterface(0x1626ba7e));
    }

    function test_ecdsaAloneIsRefused() public {
        vm.expectRevert(QuantumGuard.MissingPQSignature.selector);
        exec(ecdsa);
    }

    function test_coSignedTransactionRuns() public {
        exec(bytes.concat(ecdsa, txWitness(0)));
        assertEq(vm.parseJsonAddress(json, ".recipient").balance, 1000);
        assertTrue(guard.isLeafUsed(7));
        assertEq(safe.nonce(), 1);
    }

    function test_cosignatureIsBoundToTheTransaction() public {
        // the witness for "pay 1000 to 0xbeef" can't authorize paying someone else
        vm.expectRevert(QuantumGuard.BadPQSignature.selector);
        safe.execTransaction(makeAddr("thief"), 1000, "", bytes.concat(ecdsa, txWitness(0)));
        assertFalse(guard.isLeafUsed(7)); // the revert rolls the mark back too
    }

    function test_reusedLeafIsRefused() public {
        exec(bytes.concat(ecdsa, txWitness(0)));
        vm.expectRevert(abi.encodeWithSelector(QuantumGuard.LeafUsed.selector, 7));
        exec(bytes.concat(ecdsa, txWitness(1)));
    }

    function test_nextLeafWorks() public {
        exec(bytes.concat(ecdsa, txWitness(0)));
        exec(bytes.concat(ecdsa, txWitness(2)));
        assertEq(vm.parseJsonAddress(json, ".recipient").balance, 2000);
    }

    function test_onlyTheSafeCanAskTheGuard() public {
        vm.expectRevert(QuantumGuard.NotTheSafe.selector);
        guard.checkTransaction(address(1), 0, "", 0, 0, 0, 0, address(0), payable(address(0)), bytes.concat(ecdsa, txWitness(0)), address(this));
    }

    function test_erc1271NeedsThePQKey() public {
        safe.setFallbackHandler(address(guard));
        bytes32 dataHash = vm.parseJsonBytes32(json, ".message.dataHash");
        assertEq(guard.messageData(dataHash).length, 66);
        assertEq(keccak256(guard.messageData(dataHash)), vm.parseJsonBytes32(json, ".message.messageHash"));
        // owners' signatures alone: refused (this is the Permit2 / CoW-order path a transaction guard can't see)
        assertEq(IERC1271(address(safe)).isValidSignature(dataHash, ecdsa), bytes4(0xffffffff));
        guard.approveMessage(dataHash, vm.parseJsonBytes(json, ".message.witness"));
        assertEq(IERC1271(address(safe)).isValidSignature(dataHash, ecdsa), bytes4(0x1626ba7e));
        // asked directly instead of through the Safe: refused
        assertEq(guard.isValidSignature(dataHash, ecdsa), bytes4(0xffffffff));
    }

    function callGuard(bytes4 sel) internal {
        safe.execTransaction(address(guard), 0, abi.encodePacked(sel), ecdsa); // owners only, no PQ witness
    }

    function test_lostKeyRecoveryAfterTheTimelock() public {
        callGuard(QuantumGuard.startRecovery.selector);
        assertEq(guard.recoveryReadyAt(), block.timestamp + delay);
        vm.expectRevert(abi.encodeWithSelector(QuantumGuard.RecoveryNotReady.selector, block.timestamp + delay));
        callGuard(QuantumGuard.finishRecovery.selector);
        vm.warp(block.timestamp + delay);
        callGuard(QuantumGuard.finishRecovery.selector);
        assertTrue(guard.recovered());
        exec(ecdsa); // the owners act alone again, e.g. to remove the guard
        assertEq(vm.parseJsonAddress(json, ".recipient").balance, 1000);
    }

    function test_pqKeyVetoesARecovery() public {
        callGuard(QuantumGuard.startRecovery.selector); // what a quantum attacker with the owners' keys could do
        guard.cancelRecovery(vm.parseJsonBytes(json, ".cancelRecovery.witness"));
        assertEq(guard.recoveryReadyAt(), 0);
        vm.warp(block.timestamp + delay);
        vm.expectRevert(QuantumGuard.NoRecovery.selector);
        callGuard(QuantumGuard.finishRecovery.selector);
        vm.expectRevert(QuantumGuard.MissingPQSignature.selector);
        exec(ecdsa);
    }

    function test_recoveryOnlyThroughASafeTransaction() public {
        vm.expectRevert(QuantumGuard.NotTheSafe.selector);
        guard.startRecovery(); // a stranger
        safe.setFallbackHandler(address(guard));
        vm.expectRevert("handler reverted");
        QuantumGuard(address(safe)).startRecovery(); // through the Safe's fallback: the appended caller gives it away
        // any other call to the guard still needs the PQ key
        vm.expectRevert(QuantumGuard.MissingPQSignature.selector);
        safe.execTransaction(address(guard), 0, abi.encodeWithSelector(QuantumGuard.rotate.selector, bytes32(0), bytes32(0), ""), ecdsa);
    }

    function test_factoryDeploysAtThePredictedAddress() public {
        QuantumGuardFactory f = new QuantumGuardFactory(verifier);
        bytes32 r = vm.parseJsonBytes32(json, ".root");
        bytes32 s = vm.parseJsonBytes32(json, ".pubSeed");
        address predicted = f.predict(address(safe), r, s, delay);
        address g = f.deploy(address(safe), r, s, delay);
        assertEq(g, predicted);
        assertEq(QuantumGuard(g).safe(), address(safe));
        assertEq(QuantumGuard(g).recoveryDelay(), delay);
        assertEq(f.deploy(address(safe), r, s, delay), g); // idempotent
    }

    function test_rotateToAFreshKey() public {
        exec(bytes.concat(ecdsa, txWitness(0)));
        bytes32 newRoot = vm.parseJsonBytes32(json, ".rotate.newRoot");
        guard.rotate(newRoot, vm.parseJsonBytes32(json, ".rotate.newPubSeed"), vm.parseJsonBytes(json, ".rotate.witness"));
        assertEq(guard.root(), newRoot);
        assertFalse(guard.isLeafUsed(7)); // fresh key, fresh leaves
        // the old key no longer co-signs
        vm.expectRevert(QuantumGuard.BadPQSignature.selector);
        exec(bytes.concat(ecdsa, txWitness(2)));
    }
}
