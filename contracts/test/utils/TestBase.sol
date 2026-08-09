// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertData) external;
    function prank(address msgSender) external;
    function revertToState(uint256 snapshotId) external returns (bool success);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function snapshotState() external returns (uint256 snapshotId);
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory values) {
        return new FuzzArtifactSelector[](0);
    }

    function targetArtifacts() public pure returns (string[] memory values) {
        return new string[](0);
    }

    function excludeArtifacts() public pure returns (string[] memory values) {
        return new string[](0);
    }

    function targetSenders() public pure returns (address[] memory values) {
        return new address[](0);
    }

    function excludeSenders() public pure returns (address[] memory values) {
        return new address[](0);
    }

    function excludeContracts() public pure returns (address[] memory values) {
        return new address[](0);
    }

    function targetInterfaces() public pure returns (FuzzInterface[] memory values) {
        return new FuzzInterface[](0);
    }

    function targetSelectors() public pure returns (FuzzSelector[] memory values) {
        return new FuzzSelector[](0);
    }

    function excludeSelectors() public pure returns (FuzzSelector[] memory values) {
        return new FuzzSelector[](0);
    }

    error AssertionFailed();
    error AssertionEqAddressFailed(address left, address right);
    error AssertionEqBytes32Failed(bytes32 left, bytes32 right);
    error AssertionEqUintFailed(uint256 left, uint256 right);

    function assertTrue(bool value) internal pure {
        if (!value) revert AssertionFailed();
    }

    function assertFalse(bool value) internal pure {
        if (value) revert AssertionFailed();
    }

    function assertEq(address left, address right) internal pure {
        if (left != right) revert AssertionEqAddressFailed(left, right);
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        if (left != right) revert AssertionEqBytes32Failed(left, right);
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        if (left != right) revert AssertionEqUintFailed(left, right);
    }
}

