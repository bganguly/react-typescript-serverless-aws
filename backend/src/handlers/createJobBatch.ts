import { randomUUID } from "crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PublishCommand } from "@aws-sdk/client-sns";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, sns } from "../lib/clients";
import type { JobItem } from "../types/job";

const tableName = process.env.JOBS_TABLE;
const topicArn = process.env.JOBS_TOPIC_ARN;

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
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    return { statusCode: 400, body: JSON.stringify({ error: "messages must be a non-empty array of up to 200 strings" }) };
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

  await Promise.all([
    ...jobs.map(job => ddb.send(new PutCommand({ TableName: tableName, Item: job }))),
    ...jobs.map(job => sns.send(new PublishCommand({ TopicArn: topicArn, Message: JSON.stringify({ jobId: job.jobId }) })))
  ]);

  return {
    statusCode: 202,
    body: JSON.stringify(
      jobs.map(({ jobId, status, message, createdAt, updatedAt }) => ({ jobId, status, message, createdAt, updatedAt }))
    )
  };
};
