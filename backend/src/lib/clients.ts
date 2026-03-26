import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export const sns = new SNSClient({});
