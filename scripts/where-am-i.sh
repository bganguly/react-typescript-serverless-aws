#!/usr/bin/env bash
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
SERVICE_NAME="react-lambda-streaming-sample"
TABLE_NAME="${SERVICE_NAME}-${STAGE}-jobs"
STACK_NAME="${SERVICE_NAME}-${STAGE}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ARN="$(aws sts get-caller-identity --query Arn --output text)"

cd "${BACKEND_DIR}"
INFO_OUTPUT="$(npx sls info --verbose --stage "${STAGE}" --region "${REGION}" 2>&1)"
API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'HttpApiUrl:' | tail -n 1 | sed -E 's/.*HttpApiUrl:[[:space:]]*//' || true)"

if [[ -z "${API_URL}" ]]; then
  API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'POST - https?://' | head -n 1 | sed -E 's/.*POST - (https?:\/\/[^ ]+).*/\1/' | sed -E 's#/jobs(/.*)?$##' || true)"
fi

TABLE_STATUS="NOT_FOUND"
if aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  TABLE_STATUS="$(aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" --query 'Table.TableStatus' --output text)"
fi

echo "AWS Account: ${ACCOUNT_ID}"
echo "Principal: ${ARN}"
echo "Region: ${REGION}"
echo "Stage: ${STAGE}"
echo "Stack: ${STACK_NAME}"
if [[ -n "${API_URL}" ]]; then
  echo "HttpApiUrl: ${API_URL}"
else
  echo "HttpApiUrl: not found in stack output"
fi
echo "DynamoDB Table: ${TABLE_NAME}"
echo "DynamoDB Status: ${TABLE_STATUS}"
