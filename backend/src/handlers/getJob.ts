import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/clients";
import type { JobItem } from "../types/job";

const tableName = process.env.JOBS_TABLE;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!tableName) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing server configuration" })
    };
  }

  const jobId = event.pathParameters?.jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "jobId is required" })
    };
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { jobId }
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Job not found" })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(result.Item as JobItem)
  };
};
