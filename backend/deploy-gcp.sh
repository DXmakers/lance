#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
REPO_NAME="lance-backend"
IMAGE_NAME="api"
IMAGE_TAG="latest"
SERVICE_NAME="lance-api"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "Starting Deployment for Project: ${PROJECT_ID}"
echo "------------------------------------------------"

# 1. Verify Authentication
if ! gcloud auth print-access-token &> /dev/null; then
    echo "Error: Not authenticated with Google Cloud. Please run 'gcloud auth login' first."
    exit 1
fi

# 2. Check/Create Artifact Registry Repository
if ! gcloud artifacts repositories describe ${REPO_NAME} --location=${REGION} &> /dev/null; then
    echo "Creating Artifact Registry repository '${REPO_NAME}'..."
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --description="Docker repository for Lance backend"
else
    echo "Artifact Registry repository '${REPO_NAME}' exists."
fi

# Configure Docker auth
echo "Configuring Docker auth for Artifact Registry..."
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# 3. Build the Docker Image
echo "Building Docker image..."
docker build -t ${IMAGE_URI} -f Dockerfile .

# 4. Push the Docker Image
echo "Pushing Docker image to Google Artifact Registry..."
docker push ${IMAGE_URI}

# 5. Load Environment Variables
echo "Loading environment variables from .env..."
if [ ! -f .env ]; then
    echo "Error: .env file not found in backend directory. Please create it first."
    exit 1
fi

# Extract DB and RPC vars safely
DATABASE_URL=$(grep -x 'DATABASE_URL=.*' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
STELLAR_RPC_URL=$(grep -x 'STELLAR_RPC_URL=.*' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
STELLAR_NETWORK_PASSPHRASE=$(grep -x 'STELLAR_NETWORK_PASSPHRASE=.*' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")

echo "Retrieving Cloud SQL Connection Name..."
CONNECTION_NAME=$(gcloud sql instances describe lance-db --format="value(connectionName)")

# 6. Deploy to Cloud Run
echo "Deploying to Google Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_URI} \
    --region ${REGION} \
    --allow-unauthenticated \
    --port=3001 \
    --add-cloudsql-instances=${CONNECTION_NAME} \
    --set-env-vars="APP_ENV=production" \
    --set-env-vars="DATABASE_URL=${DATABASE_URL}" \
    --set-env-vars="STELLAR_RPC_URL=${STELLAR_RPC_URL}" \
    --set-env-vars="STELLAR_NETWORK_PASSPHRASE=${STELLAR_NETWORK_PASSPHRASE}" \
    --set-env-vars="LOG_FORMAT=json"

echo "------------------------------------------------"
echo "Deployment Complete!"
echo "Check your new live URL above."
