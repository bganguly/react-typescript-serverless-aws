import { randomUUID } from "crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PublishBatchCommand } from "@aws-sdk/client-sns";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, sns } from "../lib/clients";
import type { JobItem } from "../types/job";

const tableName = process.env.JOBS_TABLE;
const topicArn = process.env.JOBS_TOPIC_ARN;

async function throttled<T>(fns: Array<() => Promise<T>>, concurrency = 50): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < fns.length) { const idx = i++; await fns[idx](); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, worker));
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!tableName || !topicArn) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing server configuration" }) };
  }

  let parsedBody: { messages?: unknown } = {};
  try {
    parsedBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Request body must be valid JSON" }) };
  }

  const { messages } = parsedBody;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 10000) {
    return { statusCode: 400, body: JSON.stringify({ error: "messages must be a non-empty array of up to 10000 strings" }) };
  }

  const trimmed = (messages as unknown[]).map(m => (typeof m === "string" ? m.trim() : ""));
  if (trimmed.some(m => !m)) {
    return { statusCode: 400, body: JSON.stringify({ error: "All messages must be non-empty strings" }) };
  }

  const now = new Date().toISOString();
  const jobs: JobItem[] = trimmed.map(message => ({
    jobId: randomUUID(),
    message,
    status: "PENDING",
    createdAt: now,
    updatedAt: now
  }));

  // DynamoDB BatchWriteItem: max 25 items per call
  const dbChunks: JobItem[][] = [];
  for (let i = 0; i < jobs.length; i += 25) dbChunks.push(jobs.slice(i, i + 25));

  // SNS PublishBatch: max 10 messages per call
  const snsChunks: JobItem[][] = [];
  for (let i = 0; i < jobs.length; i += 10) snsChunks.push(jobs.slice(i, i + 10));

  await Promise.all([
    throttled(dbChunks.map(chunk => () => ddb.send(new BatchWriteCommand({
      RequestItems: { [tableName]: chunk.map(job => ({ PutRequest: { Item: job } })) }
    })))),
    throttled(snsChunks.map((chunk, ci) => () => sns.send(new PublishBatchCommand({
      TopicArn: topicArn,
      PublishBatchRequestEntries: chunk.map((job, ji) => ({
        Id: `${ci}-${ji}`,
        Message: JSON.stringify({ jobId: job.jobId })
      }))
    }))))
  ]);

  return {
    statusCode: 202,
    body: JSON.stringify(
      jobs.map(({ jobId, status, message, createdAt, updatedAt }) => ({ jobId, status, message, createdAt, updatedAt }))
    )
  };
};
