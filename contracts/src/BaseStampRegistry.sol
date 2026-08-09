// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title BaseStampRegistry
/// @notice Canonical, ownerless registry for privacy-preserving BaseStamp commitments.
/// @dev The contract deliberately has no admin, upgrade, payment, withdrawal, or arbitrary-call surface.
contract BaseStampRegistry is EIP712 {
    struct Stamp {
        address creator;
        uint64 createdAt;
        bytes32 contentCommitment;
        bytes32 metadataHash;
    }

    struct StampAuthorization {
        address creator;
        bytes32 contentCommitment;
        bytes32 metadataHash;
        bytes32 stampNonce;
        uint64 deadline;
    }

    bytes32 private constant STAMP_AUTHORIZATION_TYPEHASH = keccak256(
        "StampAuthorization(address creator,bytes32 contentCommitment,bytes32 metadataHash,bytes32 stampNonce,uint64 deadline)"
    );

    mapping(bytes32 stampId => Stamp stamp) private _stamps;
    mapping(address creator => mapping(bytes32 stampNonce => bool used)) private _usedStampNonces;

    event StampCreated(
        bytes32 indexed stampId,
        address indexed creator,
        bytes32 indexed contentCommitment,
        bytes32 metadataHash,
        uint64 createdAt
    );

    error ZeroCreator();
    error EmptyContentCommitment();
    error EmptyStampNonce();
    error AuthorizationExpired(uint64 deadline);
    error InvalidAuthorizationSignature();
    error StampNonceAlreadyUsed(address creator, bytes32 stampNonce);
    error StampAlreadyExists(bytes32 stampId);
    error StampNotFound(bytes32 stampId);

    constructor() EIP712("BaseStampRegistry", "1") {}

    /// @notice Creates a stamp owned by the caller.
    function createStamp(bytes32 contentCommitment, bytes32 metadataHash, bytes32 stampNonce)
        external
        returns (bytes32 stampId)
    {
        _validateStampInput(msg.sender, contentCommitment, stampNonce);
        return _createStamp(msg.sender, contentCommitment, metadataHash, stampNonce);
    }

    /// @notice Relays a creator-authorized stamp. Any address may submit a valid authorization.
    function createStampFor(StampAuthorization calldata auth, bytes calldata signature)
        external
        returns (bytes32 stampId)
    {
        _validateStampInput(auth.creator, auth.contentCommitment, auth.stampNonce);

        if (auth.deadline < block.timestamp) {
            revert AuthorizationExpired(auth.deadline);
        }

        bytes32 structHash = keccak256(
            abi.encode(
                STAMP_AUTHORIZATION_TYPEHASH,
                auth.creator,
                auth.contentCommitment,
                auth.metadataHash,
                auth.stampNonce,
                auth.deadline
            )
        );

        if (!SignatureChecker.isValidSignatureNowCalldata(auth.creator, _hashTypedDataV4(structHash), signature)) {
            revert InvalidAuthorizationSignature();
        }

        return _createStamp(auth.creator, auth.contentCommitment, auth.metadataHash, auth.stampNonce);
    }

    /// @notice Returns a recorded stamp or reverts when the ID is unknown.
    function getStamp(bytes32 stampId) external view returns (Stamp memory stamp) {
        if (!exists(stampId)) {
            revert StampNotFound(stampId);
        }
        return _stamps[stampId];
    }

    /// @notice Returns whether a stamp ID has been recorded.
    function exists(bytes32 stampId) public view returns (bool) {
        return _stamps[stampId].creator != address(0);
    }

    function _validateStampInput(address creator, bytes32 contentCommitment, bytes32 stampNonce) private pure {
        if (creator == address(0)) {
            revert ZeroCreator();
        }
        if (contentCommitment == bytes32(0)) {
            revert EmptyContentCommitment();
        }
        if (stampNonce == bytes32(0)) {
            revert EmptyStampNonce();
        }
    }

    function _createStamp(address creator, bytes32 contentCommitment, bytes32 metadataHash, bytes32 stampNonce)
        private
        returns (bytes32 stampId)
    {
        stampId = keccak256(
            abi.encode(block.chainid, address(this), creator, contentCommitment, metadataHash, stampNonce)
        );

        if (exists(stampId)) {
            revert StampAlreadyExists(stampId);
        }
        if (_usedStampNonces[creator][stampNonce]) {
            revert StampNonceAlreadyUsed(creator, stampNonce);
        }

        _usedStampNonces[creator][stampNonce] = true;

        uint64 createdAt = uint64(block.timestamp);
        _stamps[stampId] = Stamp({
            creator: creator, createdAt: createdAt, contentCommitment: contentCommitment, metadataHash: metadataHash
        });

        emit StampCreated(stampId, creator, contentCommitment, metadataHash, createdAt);
    }
}

