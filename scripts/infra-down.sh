#!/usr/bin/env bash
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SERVICE_NAME="react-lambda-streaming-sample"
STACK_NAME="${SERVICE_NAME}-${STAGE}"

stack_exists() {
  aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" >/dev/null 2>&1
}

# ── Frontend (S3 + CloudFront) ────────────────────────────────────────────────
CF_STATE="${ROOT_DIR}/.cf-state"
if [[ ! -f "${CF_STATE}" ]]; then
  echo "No .cf-state found, skipping frontend teardown."
else
  # shellcheck source=/dev/null
  source "${CF_STATE}"
  BUCKET_NAME="react-lambda-streaming-sample-${STAGE}-site"

  echo "Disabling CloudFront distribution: ${DISTRIBUTION_ID}"
  DIST_INFO="$(aws cloudfront get-distribution-config --id "${DISTRIBUTION_ID}")"
  ETAG="$(echo "${DIST_INFO}" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])")"

  DISABLED_CONFIG_FILE="$(mktemp)"
  echo "${DIST_INFO}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
cfg = data['DistributionConfig']
cfg['Enabled'] = False
print(json.dumps(cfg))
" > "${DISABLED_CONFIG_FILE}"

  aws cloudfront update-distribution \
    --id "${DISTRIBUTION_ID}" \
    --if-match "${ETAG}" \
    --distribution-config "file://${DISABLED_CONFIG_FILE}" \
    --output text --no-cli-pager >/dev/null
  rm -f "${DISABLED_CONFIG_FILE}"

  echo "Waiting for CloudFront to reach Deployed state (may take ~10-15 min)..."
  while true; do
    STATUS="$(aws cloudfront get-distribution --id "${DISTRIBUTION_ID}" \
      --query 'Distribution.Status' --output text)"
    [[ "${STATUS}" == "Deployed" ]] && break
    printf '.'
    sleep 15
  done
  echo ""

  ETAG="$(aws cloudfront get-distribution-config --id "${DISTRIBUTION_ID}" \
    --query 'ETag' --output text)"

  echo "Deleting CloudFront distribution: ${DISTRIBUTION_ID}"
  aws cloudfront delete-distribution \
    --id "${DISTRIBUTION_ID}" \
    --if-match "${ETAG}"

  OAC_ETAG="$(aws cloudfront get-origin-access-control \
    --id "${OAC_ID}" --query 'ETag' --output text)"
  echo "Deleting OAC: ${OAC_ID}"
  aws cloudfront delete-origin-access-control \
    --id "${OAC_ID}" \
    --if-match "${OAC_ETAG}"

  echo "Emptying S3 bucket: ${BUCKET_NAME}"
  aws s3 rm "s3://${BUCKET_NAME}/" --recursive
  echo "Deleting S3 bucket: ${BUCKET_NAME}"
  aws s3api delete-bucket --bucket "${BUCKET_NAME}" --region "${REGION}"

  rm -f "${CF_STATE}"
  echo "Frontend infrastructure removed."
fi

# ── Backend (Serverless / CloudFormation) ─────────────────────────────────────
if stack_exists; then
  echo "Removing backend stack: ${STACK_NAME}"
  cd "${ROOT_DIR}/backend"
  npx sls remove --stage "${STAGE}" --region "${REGION}"
  echo "Backend removed."
else
  echo "Backend stack not found, nothing to remove: ${STACK_NAME}"
fi
