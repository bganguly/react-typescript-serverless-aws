export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED";

export interface JobItem {
  jobId: string;
  message: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  result?: string;
}
