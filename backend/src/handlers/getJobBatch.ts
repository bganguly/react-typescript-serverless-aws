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
  if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.length > 10000) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobIds must be a non-empty array of up to 10000 strings" }) };
  }

  // DynamoDB BatchGetItem hard limit is 100 keys per call — chunk for counts > 100
  const ids = jobIds as string[];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const responses = await Promise.all(
    chunks.map(chunk => ddb.send(new BatchGetCommand({
      RequestItems: {
        [tableName]: { Keys: chunk.map(jobId => ({ jobId })) }
      }
    })))
  );

  const items = responses.flatMap(r => (r.Responses?.[tableName] ?? []) as JobItem[]);

  return {
    statusCode: 200,
    body: JSON.stringify(
      items.map(({ jobId, status, message, createdAt, updatedAt, processingAt, processedAt, result: res }) => ({
        jobId, status, message, createdAt, updatedAt, processingAt, processedAt, result: res
      }))
    )
  };
};
