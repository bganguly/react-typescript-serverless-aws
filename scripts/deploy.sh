#!/usr/bin/env bash
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
CF_STATE="${ROOT_DIR}/.cf-state"
BUCKET_NAME="react-lambda-streaming-sample-${STAGE}-site"

echo "[1/3] Checking AWS credentials..."
aws sts get-caller-identity >/dev/null 2>&1 \
  || { echo "  Run: aws configure"; exit 1; }
echo "  Credentials valid."
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

_GH_REPO="$(git -C "${ROOT_DIR}" remote get-url origin 2>/dev/null \
  | sed 's|.*github\.com[:/]\(.*\)\.git$|\1|; s|.*github\.com[:/]\(.*\)$|\1|')"
if command -v gh >/dev/null 2>&1 && [[ -n "${_GH_REPO}" ]]; then
  printf '  Syncing AWS credentials to GitHub Actions secrets (%s)...\n' "${_GH_REPO}"
  aws configure get aws_access_key_id     | gh secret set AWS_ACCESS_KEY_ID     --repo "${_GH_REPO}"
  aws configure get aws_secret_access_key | gh secret set AWS_SECRET_ACCESS_KEY --repo "${_GH_REPO}"
  if [[ -f "${CF_STATE}" ]]; then
    source "${CF_STATE}"
    printf '%s' "${DISTRIBUTION_ID}" | gh secret set CF_DISTRIBUTION_ID --repo "${_GH_REPO}"
  fi
fi

# ── Backend: Serverless deploy ────────────────────────────────────────────────
echo ""
echo "[2/3] Deploying backend..."
cd "${BACKEND_DIR}"
[[ -d node_modules ]] || npm install
npx sls deploy --stage "${STAGE}" --region "${REGION}"

INFO_OUTPUT="$(npx sls info --verbose --stage "${STAGE}" --region "${REGION}" 2>&1)"

API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'HttpApiUrl:' | tail -n 1 | sed -E 's/.*HttpApiUrl:[[:space:]]*//')"
if [[ -z "${API_URL}" ]]; then
  API_URL="$(printf '%s\n' "${INFO_OUTPUT}" | grep -E 'POST - https?://' | head -n 1 \
    | sed -E 's/.*POST - (https?:\/\/[^ ]+).*/\1/' | sed -E 's#/jobs(/.*)?$##')"
fi
API_URL="${API_URL//amazonaws.comamazonaws.com/amazonaws.com}"
[[ -n "${API_URL}" ]] || { echo "Could not resolve HttpApiUrl."; exit 1; }
echo "  HttpApiUrl: ${API_URL}"

# ── Frontend: S3 + CloudFront ─────────────────────────────────────────────────
echo ""
echo "[3/3] Deploying frontend..."
cd "${ROOT_DIR}"

if ! aws s3api head-bucket --bucket "${BUCKET_NAME}" 2>/dev/null; then
  echo "Creating S3 bucket: ${BUCKET_NAME}"
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "${BUCKET_NAME}" --region "${REGION}"
  else
    aws s3api create-bucket --bucket "${BUCKET_NAME}" --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}"
  fi
  aws s3api put-public-access-block --bucket "${BUCKET_NAME}" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
fi

if [[ -f "${CF_STATE}" ]]; then
  # shellcheck source=/dev/null
  source "${CF_STATE}"
  echo "Using existing CloudFront distribution: ${DISTRIBUTION_ID}"
else
  echo "Creating CloudFront OAC..."
  OAC_CONFIG_FILE="$(mktemp)"
  cat > "${OAC_CONFIG_FILE}" <<EOF
{
  "Name": "react-lambda-streaming-${STAGE}-oac",
  "Description": "OAC for ${BUCKET_NAME}",
  "SigningProtocol": "sigv4",
  "SigningBehavior": "always",
  "OriginAccessControlOriginType": "s3"
}
EOF
  OAC_ID="$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "file://${OAC_CONFIG_FILE}" \
    --query 'OriginAccessControl.Id' --output text)"
  rm -f "${OAC_CONFIG_FILE}"

  echo "Creating CloudFront distribution..."
  DIST_CONFIG_FILE="$(mktemp)"
  cat > "${DIST_CONFIG_FILE}" <<EOF
{
  "CallerReference": "react-lambda-streaming-${STAGE}-$(date +%s)",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "s3-${BUCKET_NAME}",
      "DomainName": "${BUCKET_NAME}.s3.${REGION}.amazonaws.com",
      "S3OriginConfig": {"OriginAccessIdentity": ""},
      "OriginAccessControlId": "${OAC_ID}"
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-${BUCKET_NAME}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "DefaultRootObject": "index.html",
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [{
      "ErrorCode": 403,
      "ResponseCode": "200",
      "ResponsePagePath": "/index.html",
      "ErrorCachingMinTTL": 0
    }]
  },
  "Comment": "react-lambda-streaming-${STAGE} frontend",
  "Enabled": true,
  "HttpVersion": "http2"
}
EOF
  DIST_JSON="$(aws cloudfront create-distribution \
    --distribution-config "file://${DIST_CONFIG_FILE}")"
  rm -f "${DIST_CONFIG_FILE}"

  eval "$(echo "${DIST_JSON}" | python3 -c "
import sys, json
d = json.load(sys.stdin)['Distribution']
print('DISTRIBUTION_ID=' + d['Id'])
print('DOMAIN=' + d['DomainName'])
")"

  printf 'DISTRIBUTION_ID=%s\nDOMAIN=%s\nOAC_ID=%s\n' \
    "${DISTRIBUTION_ID}" "${DOMAIN}" "${OAC_ID}" > "${CF_STATE}"

  BUCKET_POLICY_FILE="$(mktemp)"
  cat > "${BUCKET_POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFront",
    "Effect": "Allow",
    "Principal": {"Service": "cloudfront.amazonaws.com"},
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${BUCKET_NAME}/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}"
      }
    }
  }]
}
EOF
  aws s3api put-bucket-policy --bucket "${BUCKET_NAME}" --policy "file://${BUCKET_POLICY_FILE}"
  rm -f "${BUCKET_POLICY_FILE}"
  echo "CloudFront distribution created: ${DISTRIBUTION_ID}"
fi

echo "Building frontend..."
VITE_API_BASE_URL="${API_URL}" npm --prefix "${ROOT_DIR}/frontend" run build

{
  printf '<script>window._apiBase = "%s";</script>\n' "${API_URL}"
  cat "${ROOT_DIR}/api-explorer.html"
} > "${ROOT_DIR}/frontend/dist/api-explorer.html"

echo "Syncing to S3..."
aws s3 sync "${ROOT_DIR}/frontend/dist/" "s3://${BUCKET_NAME}/" --delete

echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" --query 'Invalidation.Id' --output text

PORTFOLIO_SET_LIVE="$(cd "$ROOT_DIR/../../portfolio/scripts" 2>/dev/null && pwd || true)/set-live-url.sh"
if [[ -n "${DOMAIN:-}" && -f "$PORTFOLIO_SET_LIVE" ]]; then
  bash "$PORTFOLIO_SET_LIVE" serverless "https://${DOMAIN}" "https://${DOMAIN}/api-explorer.html"
fi

echo ""
echo "[deploy] Done."
echo "  API:      ${API_URL}"
echo "  Frontend: https://${DOMAIN}"
