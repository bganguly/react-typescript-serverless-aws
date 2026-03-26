# React + Lambda + SNS/SQS + DynamoDB (Serverless)

A minimal sample you can deploy with `sls deploy`.

## Architecture

1. React app sends `POST /jobs` to API Gateway.
2. `createJob` Lambda writes a `PENDING` record to DynamoDB and publishes SNS event.
3. SNS fans out to SQS.
4. `processJob` Lambda consumes SQS event, marks `PROCESSING`, simulates work, then marks `COMPLETED`.
5. React polls `GET /jobs/{jobId}` to display status/result.

## Prerequisites

- Node.js 20+
- AWS credentials configured in your shell (`aws configure`)
- Serverless Framework account login if your setup requires it

## Folder layout

- `backend`: Serverless + Lambda + AWS resources
- `frontend`: React + TypeScript (Vite)

## Deploy backend

From the repo root (recommended):

```bash
npm run deploy
```

This deploys the backend stack and prints `HttpApiUrl` for frontend setup.

Advanced options:

```bash
STAGE=dev REGION=us-east-1 npm run deploy
```

Direct backend command:

```bash
cd backend
npm install
npx sls deploy --stage dev --region us-east-1
```

Capture API URL:

```bash
npx sls info --stage dev --region us-east-1
```

Look for `HttpApiUrl` and copy it.

## Run frontend

From the repo root (recommended):

```bash
npm run dev
```

Production build from repo root:

```bash
npm run build:frontend
```

Direct frontend commands:

```bash
cd ../frontend
npm install
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` in `.env.local` to your `HttpApiUrl` value.

Then start:

```bash
npm run dev
```

Open the local URL shown by Vite.

## Remove backend stack

From the repo root:

```bash
npm run remove
```

With custom stage/region:

```bash
STAGE=dev REGION=us-east-1 npm run remove
```

Direct backend command:

```bash
cd ../backend
npx sls remove --stage dev --region us-east-1
```

## Notes

- This sample intentionally uses plain Lambda handlers (no Express/Nest wrapper) for speed.
- CORS is open for demo (`*`). Restrict origins before production use.
- IAM permissions are scoped to the created table/topic where possible.

## Check account and region

From repo root:

```bash
npm run where
```

This prints current AWS account, principal ARN, region, stage, stack name, API URL, and DynamoDB table status.

With custom stage/region:

```bash
STAGE=dev REGION=us-east-1 npm run where
```
