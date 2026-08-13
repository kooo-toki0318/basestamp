#!/usr/bin/env bash
set -euo pipefail

readonly expected_chain_id="8453"
readonly expected_confirmation="DEPLOY BASESTAMP REGISTRY TO BASE MAINNET 8453"
readonly deployer_account="basestamp-mainnet-deployer"
readonly signer_mode="${BASESTAMP_SIGNER_MODE:-browser}"
readonly browser_port="${BASESTAMP_BROWSER_PORT:-9545}"
readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly contracts_dir="$(cd -- "$script_dir/.." && pwd)"
readonly repository_root="$(cd -- "$contracts_dir/.." && pwd)"
readonly deployment_record="$contracts_dir/deployments/$expected_chain_id.json"
readonly broadcast_directory="$contracts_dir/broadcast/DeployBaseStampRegistry.s.sol/$expected_chain_id"
readonly dry_run_directory="$broadcast_directory/dry-run"

assert_no_canonical_mainnet_deployment() {
    if [[ -e "$deployment_record" || -L "$deployment_record" ]]; then
        echo "Refusing deployment: canonical Base Mainnet record already exists at $deployment_record." >&2
        exit 1
    fi
}

assert_no_prior_mainnet_deployment() {
    assert_no_canonical_mainnet_deployment

    # Foundry can retain timestamped run-*.json files in addition to
    # run-latest.json. Reject the chain-specific path itself so an empty,
    # renamed, partial, or symlinked prior run directory cannot be overlooked.
    if [[ -e "$broadcast_directory" || -L "$broadcast_directory" ]]; then
        echo "Refusing deployment: a prior Base Mainnet Foundry broadcast directory exists at $broadcast_directory." >&2
        echo "Inspect and verify every saved run; do not deploy a second Registry." >&2
        exit 1
    fi
}

# The simulation creates a new chain directory containing dry-run JSON. Since
# the chain directory was proven absent above, only that exact Foundry layout
# may exist after simulation. Do not delete it: it is evidence for the reviewed
# ceremony and must remain available when the real broadcast starts.
assert_current_mainnet_simulation_only() (
    assert_no_canonical_mainnet_deployment

    if [[ ! -d "$broadcast_directory" || -L "$broadcast_directory" ]]; then
        echo "Refusing deployment: Mainnet simulation did not create the expected Foundry broadcast directory." >&2
        exit 1
    fi

    shopt -s dotglob nullglob
    broadcast_entries=("$broadcast_directory"/*)
    if (( ${#broadcast_entries[@]} != 1 )) || [[ "${broadcast_entries[0]:-}" != "$dry_run_directory" ]]; then
        echo "Refusing deployment: unexpected entry exists beside the current Mainnet dry-run." >&2
        exit 1
    fi
    if [[ ! -d "$dry_run_directory" || -L "$dry_run_directory" ]]; then
        echo "Refusing deployment: the current Mainnet dry-run path is not a regular directory." >&2
        exit 1
    fi

    dry_run_entries=("$dry_run_directory"/*)
    if (( ${#dry_run_entries[@]} < 2 )); then
        echo "Refusing deployment: the current Mainnet dry-run artifacts are incomplete." >&2
        exit 1
    fi

    found_latest=false
    found_timestamped=false
    for artifact in "${dry_run_entries[@]}"; do
        artifact_name="${artifact##*/}"
        if [[ ! -f "$artifact" || -L "$artifact" || ! -s "$artifact" ]]; then
            echo "Refusing deployment: unexpected Mainnet dry-run artifact: $artifact_name." >&2
            exit 1
        fi
        if [[ "$artifact_name" == "run-latest.json" ]]; then
            found_latest=true
        elif [[ "$artifact_name" =~ ^run-[0-9]+\.json$ ]]; then
            found_timestamped=true
        else
            echo "Refusing deployment: unexpected Mainnet dry-run artifact: $artifact_name." >&2
            exit 1
        fi
    done

    if [[ "$found_latest" != true || "$found_timestamped" != true ]]; then
        echo "Refusing deployment: the current Mainnet dry-run lacks Foundry's latest or timestamped record." >&2
        exit 1
    fi
)

assert_no_prior_mainnet_deployment

raw_key_variables=(
    PRIVATE_KEY
    DEPLOYER_PRIVATE_KEY
    BASESTAMP_PRIVATE_KEY
    BASE_MAINNET_PRIVATE_KEY
)
for variable_name in "${raw_key_variables[@]}"; do
    if [[ -n "${!variable_name:-}" ]]; then
        echo "Refusing deployment: $variable_name is set." >&2
        echo "Use the browser wallet bridge, a Foundry keystore account, Ledger, or Trezor; never a raw key." >&2
        exit 1
    fi
done

: "${BASE_MAINNET_RPC_URL:?Set BASE_MAINNET_RPC_URL before deploying}"
: "${BASE_MAINNET_DEPLOYER_ADDRESS:?Set BASE_MAINNET_DEPLOYER_ADDRESS before deploying}"
: "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY; source verification is mandatory for Mainnet deployment}"

if [[ ! "$BASE_MAINNET_DEPLOYER_ADDRESS" =~ ^0x[[:xdigit:]]{40}$ ]]; then
    echo "Refusing deployment: BASE_MAINNET_DEPLOYER_ADDRESS is not a 20-byte hex address." >&2
    exit 1
fi
if [[ "${BASE_MAINNET_DEPLOYER_ADDRESS,,}" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "Refusing deployment: BASE_MAINNET_DEPLOYER_ADDRESS cannot be the zero address." >&2
    exit 1
fi

actual_chain_id="$(cast chain-id --rpc-url "$BASE_MAINNET_RPC_URL")"
if [[ "$actual_chain_id" != "$expected_chain_id" ]]; then
    echo "Refusing deployment: RPC chain ID is $actual_chain_id, expected Base Mainnet $expected_chain_id." >&2
    exit 1
fi
deployer_balance="$(cast balance "$BASE_MAINNET_DEPLOYER_ADDRESS" --rpc-url "$BASE_MAINNET_RPC_URL")"
if [[ "$deployer_balance" == "0" ]]; then
    echo "Refusing deployment: the configured Mainnet deployer has no ETH for deployment gas." >&2
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

echo "Building and checking the exact Registry artifact before Mainnet simulation."
(
    cd -- "$repository_root"
    pnpm contracts:build
    pnpm contracts:artifact:check
)

echo "Simulating the deployment against Base Mainnet without broadcasting."
(
    cd -- "$contracts_dir"
    forge script script/DeployBaseStampRegistry.s.sol:DeployBaseStampRegistry \
        --rpc-url "$BASE_MAINNET_RPC_URL" \
        --chain "$expected_chain_id" \
        --sender "$BASE_MAINNET_DEPLOYER_ADDRESS" \
        --slow
)
assert_current_mainnet_simulation_only

if [[ ! -t 0 ]]; then
    echo "Refusing deployment: final Mainnet confirmation must be entered in an interactive terminal." >&2
    exit 1
fi

echo
echo "Target: Base Mainnet (chain ID $expected_chain_id)"
echo "Deployer: $BASE_MAINNET_DEPLOYER_ADDRESS"
echo "This creates the ownerless canonical Registry and cannot be undone or upgraded."
echo "Type exactly: $expected_confirmation"
printf '> '
if ! IFS= read -r confirmation; then
    echo "Refusing deployment: confirmation could not be read." >&2
    exit 1
fi
if [[ "$confirmation" != "$expected_confirmation" ]]; then
    echo "Refusing deployment: confirmation did not match exactly." >&2
    exit 1
fi

actual_chain_id="$(cast chain-id --rpc-url "$BASE_MAINNET_RPC_URL")"
if [[ "$actual_chain_id" != "$expected_chain_id" ]]; then
    echo "Refusing deployment: RPC chain changed before broadcast." >&2
    exit 1
fi
assert_current_mainnet_simulation_only

(
    cd -- "$contracts_dir"
    forge script script/DeployBaseStampRegistry.s.sol:DeployBaseStampRegistry \
        --rpc-url "$BASE_MAINNET_RPC_URL" \
        --chain "$expected_chain_id" \
        --sender "$BASE_MAINNET_DEPLOYER_ADDRESS" \
        --broadcast \
        --verify \
        --verifier etherscan \
        --retries 10 \
        --delay 10 \
        --slow \
        "${signer_args[@]}"
)

echo "Mainnet deployment command completed."
echo "Do not enable Mainnet writes until source verification and contracts/deployments/8453.json are reviewed."
