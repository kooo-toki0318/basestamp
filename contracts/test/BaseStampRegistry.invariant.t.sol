// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { BaseStampRegistry } from "../src/BaseStampRegistry.sol";
import { TestBase, Vm } from "./utils/TestBase.sol";

contract RegistryHandler {
    struct Record {
        bytes32 stampId;
        address creator;
        bytes32 contentCommitment;
        bytes32 metadataHash;
    }

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("BaseStampRegistry");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "StampAuthorization(address creator,bytes32 contentCommitment,bytes32 metadataHash,bytes32 stampNonce,uint64 deadline)"
    );
    uint256 private constant RELAY_CREATOR_KEY = 0xC0FFEE;
    uint256 private constant MAX_RECORDS = 64;
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    BaseStampRegistry public immutable registry;
    address public immutable relayCreator;
    Record[] private _records;
    uint256 private _nonceCounter;

    constructor(BaseStampRegistry registry_) {
        registry = registry_;
        relayCreator = VM.addr(RELAY_CREATOR_KEY);
    }

    function createDirect(bytes32 contentCommitment, bytes32 metadataHash, bytes32 nonceSeed) external {
        if (_records.length >= MAX_RECORDS) return;
        if (contentCommitment == bytes32(0)) contentCommitment = bytes32(uint256(1));
        bytes32 stampNonce = _nextNonce("direct", nonceSeed);

        bytes32 stampId = registry.createStamp(contentCommitment, metadataHash, stampNonce);
        _records.push(Record(stampId, address(this), contentCommitment, metadataHash));
    }

    function createRelayed(bytes32 contentCommitment, bytes32 metadataHash, bytes32 nonceSeed) external {
        if (_records.length >= MAX_RECORDS) return;
        if (contentCommitment == bytes32(0)) contentCommitment = bytes32(uint256(1));
        bytes32 stampNonce = _nextNonce("relay", nonceSeed);
        BaseStampRegistry.StampAuthorization memory auth = BaseStampRegistry.StampAuthorization({
            creator: relayCreator,
            contentCommitment: contentCommitment,
            metadataHash: metadataHash,
            stampNonce: stampNonce,
            deadline: type(uint64).max
        });
        bytes memory signature = _sign(auth);

        bytes32 stampId = registry.createStampFor(auth, signature);
        _records.push(Record(stampId, relayCreator, contentCommitment, metadataHash));
    }

    function recordsLength() external view returns (uint256) {
        return _records.length;
    }

    function recordAt(uint256 index) external view returns (Record memory) {
        return _records[index];
    }

    function _nextNonce(string memory path, bytes32 seed) private returns (bytes32) {
        unchecked {
            ++_nonceCounter;
        }
        return keccak256(abi.encode(path, seed, _nonceCounter));
    }

    function _sign(BaseStampRegistry.StampAuthorization memory auth) private returns (bytes memory) {
        bytes32 domainSeparator =
            keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(registry)));
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
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(RELAY_CREATOR_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract BaseStampRegistryInvariantTest is TestBase {
    BaseStampRegistry private registry;
    RegistryHandler private handler;

    function setUp() public {
        registry = new BaseStampRegistry();
        handler = new RegistryHandler(registry);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_AllCreatedStampsExistAndMatchTheirCanonicalSavedValues() public view {
        uint256 length = handler.recordsLength();
        for (uint256 i = 0; i < length; ++i) {
            RegistryHandler.Record memory record = handler.recordAt(i);
            assertTrue(registry.exists(record.stampId));

            BaseStampRegistry.Stamp memory stamp = registry.getStamp(record.stampId);
            assertEq(stamp.creator, record.creator);
            assertEq(stamp.contentCommitment, record.contentCommitment);
            assertEq(stamp.metadataHash, record.metadataHash);
            assertTrue(stamp.createdAt <= block.timestamp);
        }
    }
}
