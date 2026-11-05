// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Devnet stand-in for USDC: a 6-decimal ERC-20 behind an EIP-1967 upgradeable proxy, like the real one.
/// The proxy matters: reading a balance also reads the proxy's implementation slot, which is shared state
/// that the canonical mempool won't let a paymaster read during validation.
/// Anyone can mint: test token only.
contract MockUSDCImpl {
    mapping(address => uint256) public balanceOf; // slot 0
    mapping(address => mapping(address => uint256)) public allowance; // slot 1
    uint256 public totalSupply; // slot 2

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function name() external pure returns (string memory) {
        return "Mock USD Coin (Lifeboat devnet)";
    }

    function symbol() external pure returns (string memory) {
        return "mUSDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allowance");
            allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 b = balanceOf[from];
        require(b >= amount, "balance");
        unchecked {
            balanceOf[from] = b - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Minimal EIP-1967 proxy.
contract Proxy1967 {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation) {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
