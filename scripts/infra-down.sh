#!/usr/bin/env bash
# infra-down.sh — stop local dev or tear down AWS Lambda + CloudFront stack
# Usage: ./scripts/infra-down.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${STAGE:-dev}"
REGION="${REGION:-us-east-1}"
SERVICE_NAME="react-lambda-streaming-sample"
STACK_NAME="${SERVICE_NAME}-${STAGE}"
CF_STATE="${ROOT_DIR}/.cf-state"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

_local_running=0
lsof -ti:3000 >/dev/null 2>&1 && _local_running=1 || true
_aws_deployed=0
[[ -f "$CF_STATE" ]] && _aws_deployed=1 || true

printf '\n=== react-typescript-serverless-aws teardown ===\n\n'
printf '  [1] Local  — stop local dev server'
(( _local_running )) && printf ' [running]' || printf ' [not detected]'
printf '\n'
printf '  [2] Cloud  — destroy AWS Lambda + CloudFront + S3'
(( _aws_deployed )) && printf ' [deployed]' || printf ' [not deployed]'
printf '\n'
printf '\nChoice [1/2, default 2]: '
read -r _MODE
case "$_MODE" in
  1) _TARGET="local" ;;
  *) _TARGET="cloud" ;;
esac

# ── local ─────────────────────────────────────────────────────────────────────
if [[ "$_TARGET" == "local" ]]; then
  _pid="$(lsof -ti:3000 2>/dev/null || true)"
  if [[ -n "$_pid" ]]; then
    kill "$_pid" 2>/dev/null && green '  Stopped dev server on :3000'
  else
    dim '  No process found on :3000.'
  fi
  green 'Done.'
  exit 0
fi

# ── cloud: detect CloudFront state ───────────────────────────────────────────
command -v aws >/dev/null 2>&1 || { red 'aws CLI not found'; exit 1; }
aws sts get-caller-identity >/dev/null 2>&1 || { red 'AWS credentials not configured — run: aws configure'; exit 1; }
dim "  Credentials: $(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null)"

DISTRIBUTION_ID=""
[[ -f "$CF_STATE" ]] && source "$CF_STATE"
_cf_enabled=""
if [[ -n "${DISTRIBUTION_ID:-}" ]]; then
  _cf_enabled=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" \
    --query 'Distribution.DistributionConfig.Enabled' --output text 2>/dev/null || true)
fi
printf '\n  Lambda stack: %s  CloudFront: %s\n' "$STACK_NAME" "${_cf_enabled:-unknown}"
printf '  [1] Start now  [2] Stop now  [3] Suspend schedule  [4] Resume schedule  [enter] Tear down: '
read -r _PRE_ACTION

case "${_PRE_ACTION:-}" in
  1)
    if [[ -n "${DISTRIBUTION_ID:-}" && "$_cf_enabled" == "false" ]]; then
      bold 'Enabling CloudFront distribution...'
      _config=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
      _etag=$(echo "$_config" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])")
      echo "$_config" | python3 -c "
import sys,json
d=json.load(sys.stdin); d['DistributionConfig']['Enabled']=True
print(json.dumps(d['DistributionConfig']))" > /tmp/cf-enable.json
      aws cloudfront update-distribution --id "$DISTRIBUTION_ID" \
        --if-match "$_etag" --distribution-config file:///tmp/cf-enable.json \
        --no-cli-pager >/dev/null
      rm -f /tmp/cf-enable.json
      green '  CloudFront distribution enabled (changes propagate ~5 min).'
    else
      dim '  Lambda is serverless — always available. CloudFront already enabled or not deployed.'
    fi
    exit 0
    ;;
  2)
    if [[ -n "${DISTRIBUTION_ID:-}" && "$_cf_enabled" == "true" ]]; then
      bold 'Disabling CloudFront distribution...'
      _config=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
      _etag=$(echo "$_config" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])")
      echo "$_config" | python3 -c "
import sys,json
d=json.load(sys.stdin); d['DistributionConfig']['Enabled']=False
print(json.dumps(d['DistributionConfig']))" > /tmp/cf-disable.json
      aws cloudfront update-distribution --id "$DISTRIBUTION_ID" \
        --if-match "$_etag" --distribution-config file:///tmp/cf-disable.json \
        --no-cli-pager >/dev/null
      rm -f /tmp/cf-disable.json
      green '  CloudFront distribution disabled (changes propagate ~5 min).'
    else
      dim '  Lambda is serverless — cannot be stopped without removing the stack.'
    fi
    exit 0
    ;;
  3|4)
    dim '  No scheduler configured for this project.'
    exit 0
    ;;
esac

# ── tear down ─────────────────────────────────────────────────────────────────
BUCKET_NAME="${SERVICE_NAME}-${STAGE}-site"

printf '\n  This will destroy:\n'
printf '    CloudFront distribution: %s\n' "${DISTRIBUTION_ID:-unknown}"
printf '    S3 bucket: %s\n' "$BUCKET_NAME"
printf '    Lambda stack: %s\n' "$STACK_NAME"
printf '\n  Proceed? [Y/n]: '
read -r _CONFIRM
[[ "${_CONFIRM:-y}" =~ ^[Yy]$ ]] || { red 'Aborted.'; exit 1; }

if [[ -n "${DISTRIBUTION_ID:-}" ]]; then
  bold 'Disabling and deleting CloudFront distribution...'
  _config=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
  _etag=$(echo "$_config" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])")
  echo "$_config" | python3 -c "
import sys,json
d=json.load(sys.stdin); d['DistributionConfig']['Enabled']=False
print(json.dumps(d['DistributionConfig']))" > /tmp/cf-disable.json
  aws cloudfront update-distribution --id "$DISTRIBUTION_ID" \
    --if-match "$_etag" --distribution-config file:///tmp/cf-disable.json \
    --no-cli-pager >/dev/null
  rm -f /tmp/cf-disable.json
  printf '  Waiting for CloudFront to reach Deployed state (~5-10 min)...\n'
  while true; do
    _status=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" \
      --query 'Distribution.Status' --output text)
    [[ "$_status" == "Deployed" ]] && break
    printf '.'; sleep 15
  done
  printf '\n'
  _etag=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" \
    --query 'ETag' --output text)
  aws cloudfront delete-distribution --id "$DISTRIBUTION_ID" --if-match "$_etag"
  green "  CloudFront $DISTRIBUTION_ID deleted"

  if [[ -n "${OAC_ID:-}" ]]; then
    _oac_etag=$(aws cloudfront get-origin-access-control --id "$OAC_ID" \
      --query 'ETag' --output text 2>/dev/null || true)
    [[ -n "$_oac_etag" ]] && \
      aws cloudfront delete-origin-access-control --id "$OAC_ID" --if-match "$_oac_etag" \
      && green "  OAC $OAC_ID deleted" || dim '  OAC not found'
  fi

  bold 'Emptying and deleting S3 bucket...'
  aws s3 rm "s3://${BUCKET_NAME}/" --recursive 2>/dev/null || true
  aws s3api delete-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
    && green "  $BUCKET_NAME deleted" || dim "  $BUCKET_NAME not found"

  rm -f "$CF_STATE"
  green '  .cf-state removed'
fi

bold 'Removing Lambda stack...'
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  cd "$ROOT_DIR/backend"
  npx sls remove --stage "$STAGE" --region "$REGION"
  green "  Lambda stack $STACK_NAME removed"
else
  dim "  Stack $STACK_NAME not found — skipping"
fi

green '\nAWS infrastructure torn down.'
printf '  Redeploy: ./scripts/deploy.sh\n'
