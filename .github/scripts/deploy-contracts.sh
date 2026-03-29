#!/bin/bash
set -e

# ./.github/scripts/deploy-contracts.sh
# Meticulously build and deploy Soroban contracts to Stellar Testnet.

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
FRIENDLY_NAME="deployer"

echo "🛠️  Building optimized WASM binaries..."
cargo build --target wasm32-unknown-unknown --release -p escrow -p reputation -p job_registry

# Create scripts directory if not exists (redundant for CI but good for local)
mkdir -p ./.github/scripts

# Function to deploy a contract and capture its address
deploy_contract() {
    local contract_name=$1
    local wasm_path="./target/wasm32-unknown-unknown/release/${contract_name}.wasm"
    
    echo "🚀 Deploying ${contract_name} to ${NETWORK}..."
    
    # In a real CI, STELLAR_ACCOUNT_SECRET would be provided
    # stellar contract deploy \
    #     --wasm "$wasm_path" \
    #     --source "$FRIENDLY_NAME" \
    #     --network "$NETWORK"
    
    # For now, we simulation the output or use the CLI if available
    # Assuming the CLI is available in the CI environment
    ID=$(stellar contract deploy \
        --wasm "$wasm_path" \
        --source-account "$STELLAR_ACCOUNT_SECRET" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL")
    
    echo "$ID"
}

# Ensure .env.local exists or create it
ENV_FILE=".env.local"
touch $ENV_FILE

echo "📦 Capturing Contract IDs..."

ESCROW_ID=$(deploy_contract "escrow")
REPUTATION_ID=$(deploy_contract "reputation")
JOB_REGISTRY_ID=$(deploy_contract "job_registry")

# Update .env.local with new IDs
sed -i "/NEXT_PUBLIC_ESCROW_CONTRACT_ID=/d" $ENV_FILE
echo "NEXT_PUBLIC_ESCROW_CONTRACT_ID=$ESCROW_ID" >> $ENV_FILE

sed -i "/NEXT_PUBLIC_REPUTATION_CONTRACT_ID=/d" $ENV_FILE
echo "NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REPUTATION_ID" >> $ENV_FILE

sed -i "/NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID=/d" $ENV_FILE
echo "NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID=$JOB_REGISTRY_ID" >> $ENV_FILE

echo "✅ Deployment complete! IDs saved to $ENV_FILE"
echo "Escrow: $ESCROW_ID"
echo "Reputation: $REPUTATION_ID"
echo "Job Registry: $JOB_REGISTRY_ID"

# Optional: Notify via GitHub Step Summary or similar
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
  echo "### 🚀 Deployment Successful" >> $GITHUB_STEP_SUMMARY
  echo "| Contract | ID |" >> $GITHUB_STEP_SUMMARY
  echo "| --- | --- |" >> $GITHUB_STEP_SUMMARY
  echo "| Escrow | \`$ESCROW_ID\` |" >> $GITHUB_STEP_SUMMARY
  echo "| Reputation | \`$REPUTATION_ID\` |" >> $GITHUB_STEP_SUMMARY
  echo "| Job Registry | \`$JOB_REGISTRY_ID\` |" >> $GITHUB_STEP_SUMMARY
fi
