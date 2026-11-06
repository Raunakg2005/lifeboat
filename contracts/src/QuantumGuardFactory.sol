// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {QuantumGuard} from "./QuantumGuard.sol";

/// Deploys a QuantumGuard for any Safe at a predictable address (CREATE2), so the app can install one in a single
/// Safe transaction. Deploying does nothing on its own: the Safe's owners still have to install the guard, and the
/// app reads the guard a Safe actually uses from the Safe's own storage, never from here.
contract QuantumGuardFactory {
    address public immutable verifier;

    event GuardDeployed(address indexed safe, address guard, bytes32 root, uint256 recoveryDelay);

    constructor(address verifier_) {
        verifier = verifier_;
    }

    function _salt(address safe, bytes32 root) internal pure returns (bytes32) {
        return keccak256(abi.encode(safe, root));
    }

    function _initcode(address safe, bytes32 root, bytes32 pubSeed, uint256 recoveryDelay) internal view returns (bytes memory) {
        return bytes.concat(type(QuantumGuard).creationCode, abi.encode(safe, verifier, root, pubSeed, recoveryDelay));
    }

    function predict(address safe, bytes32 root, bytes32 pubSeed, uint256 recoveryDelay) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(safe, root), keccak256(_initcode(safe, root, pubSeed, recoveryDelay))));
        return address(uint160(uint256(h)));
    }

    function deploy(address safe, bytes32 root, bytes32 pubSeed, uint256 recoveryDelay) external returns (address guard) {
        guard = predict(safe, root, pubSeed, recoveryDelay);
        if (guard.code.length == 0) {
            guard = address(new QuantumGuard{salt: _salt(safe, root)}(safe, verifier, root, pubSeed, recoveryDelay));
            emit GuardDeployed(safe, guard, root, recoveryDelay);
        }
    }
}
