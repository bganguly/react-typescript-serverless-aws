import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/clients";
import type { JobItem } from "../types/job";

const tableName = process.env.JOBS_TABLE;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!tableName) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing server configuration" }) };
  }

  let parsedBody: { jobIds?: unknown } = {};
  try {
    parsedBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Request body must be valid JSON" }) };
  }

  const { jobIds } = parsedBody;
  if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobIds must be a non-empty array of up to 100 strings" }) };
  }

  const result = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [tableName]: {
        Keys: (jobIds as string[]).map(jobId => ({ jobId }))
      }
    }
  }));

  const items = (result.Responses?.[tableName] ?? []) as JobItem[];

  return {
    statusCode: 200,
    body: JSON.stringify(
      items.map(({ jobId, status, message, createdAt, updatedAt, processingAt, processedAt, result: res }) => ({
        jobId, status, message, createdAt, updatedAt, processingAt, processedAt, result: res
      }))
    )
  };
};
