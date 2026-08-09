// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { BaseStampRegistry } from "../src/BaseStampRegistry.sol";

interface VmBroadcast {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the ownerless canonical registry using the signer selected by Forge's --account flag.
contract DeployBaseStampRegistry {
    VmBroadcast private constant VM = VmBroadcast(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (BaseStampRegistry registry) {
        VM.startBroadcast();
        registry = new BaseStampRegistry();
        VM.stopBroadcast();
    }
}
