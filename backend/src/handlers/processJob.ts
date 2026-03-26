import type { SQSEvent, SQSHandler } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/clients";

const tableName = process.env.JOBS_TABLE;

async function setStatus(jobId: string, status: string, extra: Record<string, string> = {}) {
  if (!tableName) {
    throw new Error("Missing JOBS_TABLE environment variable");
  }

  const now = new Date().toISOString();
  const names: Record<string, string> = {
    "#status": "status",
    "#updatedAt": "updatedAt"
  };
  const values: Record<string, string> = {
    ":status": status,
    ":updatedAt": now
  };

  const extraAssignments = Object.entries(extra)
    .map(([key, value]) => {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      names[nameKey] = key;
      values[valueKey] = value;
      return `${nameKey} = ${valueKey}`;
    })
    .join(", ");

  const updateExpression = [
    "SET #status = :status",
    "#updatedAt = :updatedAt",
    extraAssignments
  ]
    .filter(Boolean)
    .join(", ");

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const snsEnvelope = JSON.parse(record.body) as { Message: string };
    const payload = JSON.parse(snsEnvelope.Message) as { jobId: string };
    const jobId = payload.jobId;

    await setStatus(jobId, "PROCESSING");

    // Simulate work and persist final state.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await setStatus(jobId, "COMPLETED", {
      processedAt: new Date().toISOString(),
      result: `Processed message for job ${jobId}`
    });
  }
};
