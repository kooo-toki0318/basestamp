// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface IERC1271Minimal {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4);
}

contract ERC1271WalletMock is IERC1271Minimal {
    bytes4 private constant MAGIC_VALUE = IERC1271Minimal.isValidSignature.selector;
    address private immutable _owner;

    constructor(address owner_) {
        _owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length != 65) return bytes4(0xffffffff);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        return ecrecover(hash, v, r, s) == _owner ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

/// @dev Attempts an SSTORE while being queried. SignatureChecker's STATICCALL must make this fail.
contract StateChangingERC1271Mock {
    fallback() external {
        assembly ("memory-safe") {
            sstore(0, 1)
            mstore(0, 0x1626ba7e)
            return(0x1c, 0x04)
        }
    }
}
