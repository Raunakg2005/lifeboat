// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

/// Runs the TypeScript-made vectors through the Yul WOTS+C core (via WotsHarness) and checks
/// LifeboatAccount's constructor, dispatch and leaf floor.
/// Build the Yul first: node tools/gen-yul.mjs && node tools/build-yul.mjs
contract WotsTest is Test {
    address harness;
    string json;
    bytes32 root;
    bytes32 pubSeed;

    function deploy(bytes memory initcode) internal returns (address a) {
        assembly {
            a := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(a != address(0), "deploy failed");
    }

    function setUp() public {
        harness = deploy(vm.parseBytes(vm.readFile("yul/out/WotsHarness.initcode.hex")));
        json = vm.readFile("test/vectors/wots.json");
        root = vm.parseJsonBytes32(json, ".root");
        pubSeed = vm.parseJsonBytes32(json, ".pubSeed");
    }

    function check(uint256 i) internal returns (bool ok, uint256 coreGas, uint256 callGas) {
        string memory p = string.concat(".cases[", vm.toString(i), "]");
        bytes32 sigHash = vm.parseJsonBytes32(json, string.concat(p, ".sigHash"));
        bytes memory witness = vm.parseJsonBytes(json, string.concat(p, ".witness"));
        bool expected = vm.parseJsonBool(json, string.concat(p, ".valid"));
        uint256 g = gasleft();
        (bool success, bytes memory ret) = harness.call(abi.encodePacked(root, pubSeed, sigHash, witness));
        callGas = g - gasleft();
        require(success, "harness reverted");
        (uint256 valid, uint256 used) = abi.decode(ret, (uint256, uint256));
        ok = valid == 1;
        coreGas = used;
        assertEq(ok, expected, vm.parseJsonString(json, string.concat(p, ".name")));
    }

    function test_vectorsMatchTypeScript() public {
        uint256 n = vm.parseJsonUint(json, ".count");
        uint256 maxCore;
        for (uint256 i = 0; i < n; i++) {
            (bool ok, uint256 coreGas,) = check(i);
            if (ok && coreGas > maxCore) maxCore = coreGas;
        }
        console.log("vectors checked:", n);
        console.log("max verify-core gas over valid vectors:", maxCore);
        assertLt(maxCore, 80_000, "verify core must leave room under the 100k prefix cap");
    }

    function test_validGasIsConstant() public {
        (bool ok0, uint256 g0,) = check(0);
        (bool ok1, uint256 g1,) = check(2);
        (bool ok2, uint256 g2,) = check(4);
        assertTrue(ok0 && ok1 && ok2);
        // WOTS+C: same number of chain steps for every valid signature
        assertApproxEqAbs(g0, g1, 200);
        assertApproxEqAbs(g1, g2, 200);
    }

    function test_rejectsWrongLength() public {
        (bool success,) = harness.call(abi.encodePacked(root, pubSeed, bytes32(0), new bytes(2336 - 32)));
        assertFalse(success);
    }

    // ---- LifeboatAccount (only the paths revm can run: constructor, execute, plain transfers) ----

    function deployAccount() internal returns (address acct) {
        bytes memory init = vm.parseBytes(vm.readFile("yul/out/LifeboatAccount.initcode.hex"));
        acct = deploy(abi.encodePacked(init, root, pubSeed));
    }

    function test_accountStoresKeyAndFloor() public {
        address acct = deployAccount();
        assertEq(vm.load(acct, bytes32(uint256(0))), root);
        assertEq(vm.load(acct, bytes32(uint256(1))), pubSeed);
        assertEq(uint256(vm.load(acct, bytes32(uint256(2)))), 1);
    }

    function test_accountAcceptsEth() public {
        address acct = deployAccount();
        vm.deal(address(this), 1 ether);
        (bool ok,) = acct.call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(acct.balance, 0.5 ether);
    }

    function test_executeRaisesLeafFloorAndCalls() public {
        address acct = deployAccount();
        vm.deal(acct, 1 ether);
        address to = makeAddr("recipient");
        vm.prank(acct); // CALLER == the account itself, as in a SENDER frame
        (bool ok,) = acct.call(abi.encodePacked(uint256(5), uint256(uint160(to)), uint256(0.25 ether)));
        assertTrue(ok);
        assertEq(to.balance, 0.25 ether);
        assertEq(uint256(vm.load(acct, bytes32(uint256(2)))), 7); // leaf 5 used -> lowest usable leaf 6
        // a lower leaf never lowers the floor
        vm.prank(acct);
        (ok,) = acct.call(abi.encodePacked(uint256(2), uint256(0), uint256(0)));
        assertTrue(ok);
        assertEq(uint256(vm.load(acct, bytes32(uint256(2)))), 7);
    }

    function test_executeRejectsLeafOutsideTree() public {
        address acct = deployAccount();
        vm.prank(acct);
        (bool ok,) = acct.call(abi.encodePacked(uint256(256), uint256(0), uint256(0)));
        assertFalse(ok);
    }

    function test_strangersCannotExecute() public {
        address acct = deployAccount();
        vm.deal(acct, 1 ether);
        address to = makeAddr("thief");
        (bool ok,) = acct.call(abi.encodePacked(uint256(0), uint256(uint160(to)), uint256(1 ether)));
        assertTrue(ok); // treated as a plain call: nothing happens
        assertEq(to.balance, 0);
        assertEq(acct.balance, 1 ether);
    }

    function test_verifyPathNeedsFrameOpcodes() public {
        address acct = deployAccount();
        vm.prank(address(0xaa));
        (bool ok,) = acct.call(hex"03");
        assertFalse(ok); // SIGPARAM is not a valid opcode outside an EIP-8141 chain
    }
}
