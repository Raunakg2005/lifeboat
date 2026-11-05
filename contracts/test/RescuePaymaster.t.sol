// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDCImpl, Proxy1967} from "../src/MockUSDC.sol";

interface IPaymaster {
    function setEligible(address account, bool ok) external;
    function setConfig(address token, uint256 fee, uint256 maxCost) external;
    function exec(address to, uint256 value, bytes calldata data) external;
    function owner() external view returns (address);
    function token() external view returns (address);
    function fee() external view returns (uint256);
    function maxCost() external view returns (uint256);
    function isEligible(address account) external view returns (uint256);
}

/// The paths revm can run: constructor, owner-gated admin, ETH top-ups, and the proxied mock USDC.
/// The VERIFY path uses EIP-8141 opcodes and is exercised by dry-runs on the devnet (scripts/src/rescue.ts).
contract RescuePaymasterTest is Test {
    IPaymaster pm;
    MockUSDCImpl usdc;
    address owner = makeAddr("owner");

    function setUp() public {
        usdc = MockUSDCImpl(address(new Proxy1967(address(new MockUSDCImpl()))));
        bytes memory init = abi.encodePacked(
            vm.parseBytes(vm.readFile("yul/out/RescuePaymaster.initcode.hex")), uint256(uint160(address(usdc))), uint256(1e6), uint256(0.01 ether)
        );
        address a;
        vm.prank(owner);
        assembly {
            a := create(0, add(init, 0x20), mload(init))
        }
        require(a != address(0), "deploy failed");
        pm = IPaymaster(a);
    }

    function test_constructorConfig() public view {
        assertEq(pm.owner(), owner);
        assertEq(pm.token(), address(usdc));
        assertEq(pm.fee(), 1e6);
        assertEq(pm.maxCost(), 0.01 ether);
    }

    function test_onlyOwnerRegistersAccounts() public {
        address exposed = makeAddr("exposed");
        vm.expectRevert();
        pm.setEligible(exposed, true);
        vm.prank(owner);
        pm.setEligible(exposed, true);
        assertEq(pm.isEligible(exposed), 1);
        vm.prank(owner);
        pm.setEligible(exposed, false);
        assertEq(pm.isEligible(exposed), 0);
    }

    function test_onlyOwnerChangesConfig() public {
        vm.expectRevert();
        pm.setConfig(address(1), 2, 3);
        vm.prank(owner);
        pm.setConfig(address(1), 2, 3);
        assertEq(pm.token(), address(1));
        assertEq(pm.fee(), 2);
        assertEq(pm.maxCost(), 3);
    }

    function test_acceptsEthAndOwnerCanExec() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(pm).call{value: 0.2 ether}("");
        assertTrue(ok);
        address payable dest = payable(makeAddr("dest"));
        vm.expectRevert();
        pm.exec(dest, 0.1 ether, "");
        vm.prank(owner);
        pm.exec(dest, 0.1 ether, "");
        assertEq(dest.balance, 0.1 ether);
    }

    function test_verifyPathNeedsFrameOpcodes() public {
        vm.prank(address(0xaa));
        (bool ok,) = address(pm).call("");
        assertFalse(ok);
    }

    function test_mockUsdcThroughProxy() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        usdc.mint(a, 5e6);
        assertEq(usdc.balanceOf(a), 5e6);
        assertEq(usdc.decimals(), 6);
        vm.prank(a);
        usdc.transfer(b, 2e6);
        assertEq(usdc.balanceOf(a), 3e6);
        assertEq(usdc.balanceOf(b), 2e6);
        vm.prank(a);
        vm.expectRevert(bytes("balance"));
        usdc.transfer(b, 4e6);
    }
}
