#!/usr/bin/env bash
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

cd "${BACKEND_DIR}"
npx sls remove --stage "${STAGE}" --region "${REGION}"
