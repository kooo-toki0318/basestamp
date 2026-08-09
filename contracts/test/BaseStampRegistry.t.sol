// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { BaseStampRegistry } from "../src/BaseStampRegistry.sol";
import { ERC1271WalletMock, StateChangingERC1271Mock } from "./mocks/ERC1271WalletMock.sol";
import { TestBase } from "./utils/TestBase.sol";

contract BaseStampRegistryTest is TestBase {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("BaseStampRegistry");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "StampAuthorization(address creator,bytes32 contentCommitment,bytes32 metadataHash,bytes32 stampNonce,uint64 deadline)"
    );

    uint256 private constant CREATOR_KEY = 0xA11CE;
    uint256 private constant OTHER_CREATOR_KEY = 0xB0B;
    address private constant RELAYER_ONE = address(0x1111);
    address private constant RELAYER_TWO = address(0x2222);
    bytes32 private constant CONTENT = keccak256("content commitment");
    bytes32 private constant METADATA = keccak256("metadata hash");
    bytes32 private constant NONCE = keccak256("stamp nonce");

    BaseStampRegistry private registry;
    address private creator;
    address private otherCreator;

    event StampCreated(
        bytes32 indexed stampId,
        address indexed creator,
        bytes32 indexed contentCommitment,
        bytes32 metadataHash,
        uint64 createdAt
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        registry = new BaseStampRegistry();
        creator = vm.addr(CREATOR_KEY);
        otherCreator = vm.addr(OTHER_CREATOR_KEY);
    }

    function test_CreateStampStoresCanonicalStampAndEmitsEvent() public {
        bytes32 expectedId = _stampId(address(registry), creator, CONTENT, METADATA, NONCE);

        vm.expectEmit(true, true, true, true);
        emit StampCreated(expectedId, creator, CONTENT, METADATA, uint64(block.timestamp));

        vm.prank(creator);
        bytes32 stampId = registry.createStamp(CONTENT, METADATA, NONCE);

        assertEq(stampId, expectedId);
        assertTrue(registry.exists(stampId));
        _assertStamp(stampId, creator, CONTENT, METADATA, block.timestamp);
    }

    function test_CreateStampForAcceptsEOASignatureAndPermissionlessRelayer() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);
        bytes32 expectedId = _stampId(address(registry), creator, CONTENT, METADATA, NONCE);

        vm.expectEmit(true, true, true, true);
        emit StampCreated(expectedId, creator, CONTENT, METADATA, uint64(block.timestamp));

        vm.prank(RELAYER_ONE);
        bytes32 stampId = registry.createStampFor(auth, signature);

        assertEq(stampId, expectedId);
        _assertStamp(stampId, creator, CONTENT, METADATA, block.timestamp);
    }

    function test_DirectAndRelayedPathsReturnSameIdForSameCreatorAndInput() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);
        uint256 snapshot = vm.snapshotState();

        vm.prank(creator);
        bytes32 directId = registry.createStamp(CONTENT, METADATA, NONCE);

        assertTrue(vm.revertToState(snapshot));
        vm.prank(RELAYER_ONE);
        bytes32 relayedId = registry.createStampFor(auth, signature);

        assertEq(directId, relayedId);
    }

    function test_RelayerAddressDoesNotAffectIdOrCreator() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);
        uint256 snapshot = vm.snapshotState();

        vm.prank(RELAYER_ONE);
        bytes32 firstId = registry.createStampFor(auth, signature);

        assertTrue(vm.revertToState(snapshot));
        vm.prank(RELAYER_TWO);
        bytes32 secondId = registry.createStampFor(auth, signature);

        assertEq(firstId, secondId);
        BaseStampRegistry.Stamp memory stamp = registry.getStamp(secondId);
        assertEq(stamp.creator, creator);
    }

    function test_CreateStampForAcceptsDeployedERC1271Wallet() public {
        ERC1271WalletMock wallet = new ERC1271WalletMock(creator);
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(address(wallet), CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);

        vm.prank(RELAYER_ONE);
        bytes32 stampId = registry.createStampFor(auth, signature);

        _assertStamp(stampId, address(wallet), CONTENT, METADATA, block.timestamp);
    }

    function test_CreateStampForRejectsEveryModifiedAuthorizationField() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);

        BaseStampRegistry.StampAuthorization memory modified = auth;
        modified.creator = otherCreator;
        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(modified, signature);

        modified = auth;
        modified.contentCommitment = keccak256("modified content");
        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(modified, signature);

        modified = auth;
        modified.metadataHash = keccak256("modified metadata");
        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(modified, signature);

        modified = auth;
        modified.stampNonce = keccak256("modified nonce");
        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(modified, signature);

        modified = auth;
        modified.deadline += 1;
        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(modified, signature);
    }

    function test_CreateStampForRejectsSignatureFromDifferentChain() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid + 1);

        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(auth, signature);
    }

    function test_CreateStampForRejectsSignatureForDifferentContract() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(0xBEEF), block.chainid);

        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor(auth, signature);
    }

    function test_CreateStampForRejectsExpiredAuthorization() public {
        uint64 deadline = uint64(block.timestamp - 1);
        BaseStampRegistry.StampAuthorization memory auth = _authorization(creator, CONTENT, METADATA, NONCE, deadline);
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);

        vm.expectRevert(abi.encodeWithSelector(BaseStampRegistry.AuthorizationExpired.selector, deadline));
        registry.createStampFor(auth, signature);
    }

    function test_CreateStampForAcceptsDeadlineEqualToCurrentTimestamp() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, NONCE, uint64(block.timestamp));
        bytes memory signature = _sign(CREATOR_KEY, auth, address(registry), block.chainid);

        bytes32 stampId = registry.createStampFor(auth, signature);

        assertTrue(registry.exists(stampId));
    }

    function test_RejectsZeroCreator() public {
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(address(0), CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));

        vm.expectRevert(BaseStampRegistry.ZeroCreator.selector);
        registry.createStampFor(auth, "");
    }

    function test_RejectsEmptyContentCommitmentOnBothPaths() public {
        vm.expectRevert(BaseStampRegistry.EmptyContentCommitment.selector);
        registry.createStamp(bytes32(0), METADATA, NONCE);

        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, bytes32(0), METADATA, NONCE, uint64(block.timestamp + 1 days));
        vm.expectRevert(BaseStampRegistry.EmptyContentCommitment.selector);
        registry.createStampFor(auth, "");
    }

    function test_RejectsEmptyStampNonceOnBothPaths() public {
        vm.expectRevert(BaseStampRegistry.EmptyStampNonce.selector);
        registry.createStamp(CONTENT, METADATA, bytes32(0));

        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(creator, CONTENT, METADATA, bytes32(0), uint64(block.timestamp + 1 days));
        vm.expectRevert(BaseStampRegistry.EmptyStampNonce.selector);
        registry.createStampFor(auth, "");
    }

    function test_RejectsCreatorNonceReuseEvenWhenStampIdDiffers() public {
        vm.startPrank(creator);
        registry.createStamp(CONTENT, METADATA, NONCE);

        vm.expectRevert(abi.encodeWithSelector(BaseStampRegistry.StampNonceAlreadyUsed.selector, creator, NONCE));
        registry.createStamp(keccak256("different content"), METADATA, NONCE);
        vm.stopPrank();
    }

    function test_RejectsDuplicateStampId() public {
        bytes32 stampId = _stampId(address(registry), creator, CONTENT, METADATA, NONCE);
        vm.startPrank(creator);
        registry.createStamp(CONTENT, METADATA, NONCE);

        vm.expectRevert(abi.encodeWithSelector(BaseStampRegistry.StampAlreadyExists.selector, stampId));
        registry.createStamp(CONTENT, METADATA, NONCE);
        vm.stopPrank();
    }

    function test_SameNonceIsIndependentAcrossCreators() public {
        vm.prank(creator);
        bytes32 creatorId = registry.createStamp(CONTENT, METADATA, NONCE);

        vm.prank(otherCreator);
        bytes32 otherCreatorId = registry.createStamp(CONTENT, METADATA, NONCE);

        assertTrue(creatorId != otherCreatorId);
        assertEq(registry.getStamp(creatorId).creator, creator);
        assertEq(registry.getStamp(otherCreatorId).creator, otherCreator);
    }

    function test_GetStampRejectsUnknownId() public {
        bytes32 unknownId = keccak256("unknown stamp");

        vm.expectRevert(abi.encodeWithSelector(BaseStampRegistry.StampNotFound.selector, unknownId));
        registry.getStamp(unknownId);
    }

    function test_NormalEtherTransferIsRejected() public {
        vm.deal(address(this), 1 ether);

        (bool success,) = address(registry).call{ value: 1 wei }("");

        assertFalse(success);
        assertEq(address(registry).balance, 0);
    }

    function test_ForcedEtherCannotBeWithdrawn() public {
        vm.deal(address(registry), 1 ether);
        assertEq(address(registry).balance, 1 ether);

        (bool success,) = address(registry).call(abi.encodeWithSignature("withdraw()"));

        assertFalse(success);
        assertEq(address(registry).balance, 1 ether);
    }

    function test_ERC1271ValidationUsesStaticCall() public {
        StateChangingERC1271Mock wallet = new StateChangingERC1271Mock();
        BaseStampRegistry.StampAuthorization memory auth =
            _authorization(address(wallet), CONTENT, METADATA, NONCE, uint64(block.timestamp + 1 days));

        vm.expectRevert(BaseStampRegistry.InvalidAuthorizationSignature.selector);
        registry.createStampFor{ gas: 500_000 }(auth, hex"1234");
    }

    function test_Eip712DomainIsFixedToChainAndRegistry() public view {
        (bytes1 fields, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            registry.eip712Domain();

        assertEq(uint256(uint8(fields)), uint256(uint8(bytes1(0x0f))));
        assertEq(keccak256(bytes(name)), NAME_HASH);
        assertEq(keccak256(bytes(version)), VERSION_HASH);
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(registry));
    }

    function testFuzz_CreateStampMatchesCanonicalIdAndSavedValues(
        bytes32 contentCommitment,
        bytes32 metadataHash,
        bytes32 stampNonce
    ) public {
        if (contentCommitment == bytes32(0)) contentCommitment = bytes32(uint256(1));
        if (stampNonce == bytes32(0)) stampNonce = bytes32(uint256(1));

        bytes32 expectedId = _stampId(address(registry), creator, contentCommitment, metadataHash, stampNonce);
        vm.prank(creator);
        bytes32 stampId = registry.createStamp(contentCommitment, metadataHash, stampNonce);

        assertEq(stampId, expectedId);
        _assertStamp(stampId, creator, contentCommitment, metadataHash, block.timestamp);
    }

    function _authorization(
        address creator_,
        bytes32 contentCommitment,
        bytes32 metadataHash,
        bytes32 stampNonce,
        uint64 deadline
    ) private pure returns (BaseStampRegistry.StampAuthorization memory) {
        return BaseStampRegistry.StampAuthorization({
            creator: creator_,
            contentCommitment: contentCommitment,
            metadataHash: metadataHash,
            stampNonce: stampNonce,
            deadline: deadline
        });
    }

    function _sign(
        uint256 privateKey,
        BaseStampRegistry.StampAuthorization memory auth,
        address verifyingContract,
        uint256 chainId
    ) private returns (bytes memory) {
        bytes32 digest = _authorizationDigest(auth, verifyingContract, chainId);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _authorizationDigest(
        BaseStampRegistry.StampAuthorization memory auth,
        address verifyingContract,
        uint256 chainId
    ) private pure returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract)
        );
        bytes32 structHash = keccak256(
            abi.encode(
                AUTHORIZATION_TYPEHASH,
                auth.creator,
                auth.contentCommitment,
                auth.metadataHash,
                auth.stampNonce,
                auth.deadline
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    function _stampId(
        address registryAddress,
        address creator_,
        bytes32 contentCommitment,
        bytes32 metadataHash,
        bytes32 stampNonce
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, registryAddress, creator_, contentCommitment, metadataHash, stampNonce)
        );
    }

    function _assertStamp(
        bytes32 stampId,
        address expectedCreator,
        bytes32 expectedContent,
        bytes32 expectedMetadata,
        uint256 expectedCreatedAt
    ) private view {
        BaseStampRegistry.Stamp memory stamp = registry.getStamp(stampId);
        assertEq(stamp.creator, expectedCreator);
        assertEq(stamp.contentCommitment, expectedContent);
        assertEq(stamp.metadataHash, expectedMetadata);
        assertEq(uint256(stamp.createdAt), expectedCreatedAt);
    }
}
