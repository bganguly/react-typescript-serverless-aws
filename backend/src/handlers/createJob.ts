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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing server configuration" })
    };
  }

  let parsedBody: { message?: string } = {};

  try {
    parsedBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body must be valid JSON" })
    };
  }

  const message = parsedBody.message?.trim();

  if (!message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "message is required" })
    };
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();

  const job: JobItem = {
    jobId,
    message,
    status: "PENDING",
    createdAt: now,
    updatedAt: now
  };

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: job
    })
  );

  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify({ jobId })
    })
  );

  return {
    statusCode: 202,
    body: JSON.stringify({ jobId, status: "PENDING" })
  };
};
