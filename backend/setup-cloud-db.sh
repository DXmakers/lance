#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
INSTANCE_NAME="lance-db"
DB_NAME="lance"
DB_USER="postgres"

echo "Starting Cloud SQL Provisioning for Project: ${PROJECT_ID}"
echo "------------------------------------------------"

# 1. Generate a secure random password
DB_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)
echo "Generated secure random password."

# 2. Check if instance already exists, if not create it
if gcloud sql instances describe ${INSTANCE_NAME} &> /dev/null; then
    echo "Instance '${INSTANCE_NAME}' already exists. Skipping creation."
else
    echo "Creating Cloud SQL instance '${INSTANCE_NAME}' (This will take 3-5 minutes)..."
    gcloud sql instances create ${INSTANCE_NAME} \
        --database-version=POSTGRES_15 \
        --cpu=1 \
        --memory=3840MB \
        --region=${REGION} \
        --edition=ENTERPRISE
    echo "Instance created successfully."
fi

# 3. Set the postgres user password
echo "Setting password for user '${DB_USER}'..."
gcloud sql users set-password ${DB_USER} \
    --instance=${INSTANCE_NAME} \
    --password="${DB_PASSWORD}"
echo "Password set successfully."

# 4. Create the logical database
if gcloud sql databases describe ${DB_NAME} --instance=${INSTANCE_NAME} &> /dev/null; then
    echo "Database '${DB_NAME}' already exists. Skipping creation."
else
    echo "Creating logical database '${DB_NAME}'..."
    gcloud sql databases create ${DB_NAME} --instance=${INSTANCE_NAME}
    echo "Database created successfully."
fi

# 5. Retrieve Connection Details
echo "Retrieving Connection Name and Public IP..."
CONNECTION_NAME=$(gcloud sql instances describe ${INSTANCE_NAME} --format="value(connectionName)")
PUBLIC_IP=$(gcloud sql instances describe ${INSTANCE_NAME} --format="value(ipAddresses[0].ipAddress)")

# 6. Authorize current local IP so Prisma can push the schema
echo "Authorizing your local IP to run database migrations..."
MY_IP=$(curl -s ifconfig.me)
gcloud sql instances patch ${INSTANCE_NAME} --authorized-networks="${MY_IP}" --quiet
echo "Authorized IP: ${MY_IP}"

# 7. Generate URLs
# URL for local Prisma migrations (TCP)
LOCAL_MIGRATION_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PUBLIC_IP}:5432/${DB_NAME}?schema=public"

# URL for Cloud Run (Unix Sockets)
CLOUD_RUN_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

echo "------------------------------------------------"
echo "CLOUD SQL SETUP COMPLETE!"
echo "------------------------------------------------"
echo ""
echo "ACTION REQUIRED: Update your backend/.env file with this URL:"
echo "DATABASE_URL=\"${CLOUD_RUN_URL}\""
echo ""
echo "ACTION REQUIRED: To push your tables to the new database, run this locally ONCE:"
echo "DATABASE_URL=\"${LOCAL_MIGRATION_URL}\" npx prisma db push"
echo ""
echo "Connection Name for Cloud Run: ${CONNECTION_NAME}"
