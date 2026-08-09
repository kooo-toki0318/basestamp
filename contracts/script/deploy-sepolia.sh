#!/usr/bin/env bash
set -euo pipefail

readonly expected_chain_id="84532"
readonly deployer_account="basestamp-sepolia-deployer"
readonly signer_mode="${BASESTAMP_SIGNER_MODE:-browser}"
readonly browser_port="${BASESTAMP_BROWSER_PORT:-9545}"

: "${BASE_SEPOLIA_RPC_URL:?Set BASE_SEPOLIA_RPC_URL before deploying}"
: "${BASE_SEPOLIA_DEPLOYER_ADDRESS:?Set BASE_SEPOLIA_DEPLOYER_ADDRESS before deploying}"

actual_chain_id="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")"
if [[ "$actual_chain_id" != "$expected_chain_id" ]]; then
    echo "Refusing deployment: RPC chain ID is $actual_chain_id, expected Base Sepolia $expected_chain_id." >&2
    exit 1
fi

signer_args=()
case "$signer_mode" in
    browser)
        signer_args+=(--browser --browser-disable-open --browser-port "$browser_port")
        ;;
    keystore)
        signer_args+=(--account "$deployer_account")
        ;;
    ledger)
        signer_args+=(--ledger)
        ;;
    trezor)
        signer_args+=(--trezor)
        ;;
    *)
        echo "Unsupported BASESTAMP_SIGNER_MODE: $signer_mode" >&2
        echo "Choose browser, keystore, ledger, or trezor." >&2
        exit 1
        ;;
esac

verify_args=()
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
    verify_args+=(--verify --verifier etherscan --slow)
else
    echo "ETHERSCAN_API_KEY is empty; deployment will be broadcast without Etherscan verification." >&2
    echo "Run Sourcify or Etherscan verification separately before release." >&2
fi

forge script script/DeployBaseStampRegistry.s.sol:DeployBaseStampRegistry \
    --rpc-url "$BASE_SEPOLIA_RPC_URL" \
    --chain "$expected_chain_id" \
    --sender "$BASE_SEPOLIA_DEPLOYER_ADDRESS" \
    --broadcast \
    --slow \
    "${signer_args[@]}" \
    "${verify_args[@]}"
