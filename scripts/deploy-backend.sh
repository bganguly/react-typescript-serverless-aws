#!/usr/bin/env bash
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

cd "${BACKEND_DIR}"

if [[ ! -d node_modules ]]; then
  npm install
fi

npx sls deploy --stage "${STAGE}" --region "${REGION}"

INFO_OUTPUT="$(npx sls info --verbose --stage "${STAGE}" --region "${REGION}" 2>&1)"

API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'HttpApiUrl:' | tail -n 1 | sed -E 's/.*HttpApiUrl:[[:space:]]*//')"

if [[ -z "${API_URL}" ]]; then
  API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'POST - https?://' | head -n 1 | sed -E 's/.*POST - (https?:\/\/[^ ]+).*/\1/' | sed -E 's#/jobs(/.*)?$##')"
fi

API_URL="${API_URL//amazonaws.comamazonaws.com/amazonaws.com}"

if [[ -z "${API_URL}" ]]; then
  echo "Could not resolve HttpApiUrl from Serverless output."
  exit 1
fi

echo ""
echo "Backend deployed successfully."
echo "HttpApiUrl: ${API_URL}"
echo ""
echo "To wire frontend:"
echo "  1) cd ${ROOT_DIR}/frontend"
echo "  2) cp .env.example .env.local"
echo "  3) set VITE_API_BASE_URL=${API_URL} in .env.local"
