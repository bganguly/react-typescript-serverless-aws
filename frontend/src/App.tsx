import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED";

interface JobResponse {
  jobId: string;
  status: JobStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
  processingAt?: string;
  processedAt?: string;
  result?: string;
}

interface TrackedJob {
  counter: number;
  label: string;
  jobId: string;
  data: JobResponse | null;
  error: string | null;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const MAX_JOBS = 100;

async function fetchJob(jobId: string): Promise<JobResponse> {
  const response = await fetch(`${apiBaseUrl}/jobs/${jobId}`);
  if (!response.ok) throw new Error(`Fetch job failed with status ${response.status}`);
  return (await response.json()) as JobResponse;
}

async function createJobBatch(
  messages: string[],
  onRetry?: (attempt: number, max: number) => void
): Promise<JobResponse[]> {
  const MAX_ATTEMPTS = 4;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const response = await fetch(`${apiBaseUrl}/jobs/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages })
    });
    if (response.ok) return (await response.json()) as JobResponse[];
    if (response.status < 500 || i === MAX_ATTEMPTS - 1) {
      throw new Error(`Batch create failed with status ${response.status}`);
    }
    onRetry?.(i + 1, MAX_ATTEMPTS);
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error("unreachable");
}

function formatTs(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = d.getHours();
  return `${pad(h % 12 || 12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${h >= 12 ? "pm" : "am"}`;
}

export default function App() {
  const [message, setMessage] = useState("Build me a serverless sample");
  const [count, setCount] = useState(1);
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [counter, setCounter] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warmupMsg, setWarmupMsg] = useState<string | null>(null);
  const intervalsRef = useRef<Map<string, number>>(new Map());

  const isConfigured = Boolean(apiBaseUrl);

  const startPolling = useCallback((jobId: string) => {
    const id = window.setInterval(async () => {
      try {
        const data = await fetchJob(jobId);
        setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, data } : j));
        if (data.status === "COMPLETED") {
          window.clearInterval(intervalsRef.current.get(jobId));
          intervalsRef.current.delete(jobId);
        }
      } catch (e) {
        setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, error: (e as Error).message } : j));
        window.clearInterval(intervalsRef.current.get(jobId));
        intervalsRef.current.delete(jobId);
      }
    }, 2000);
    intervalsRef.current.set(jobId, id);
  }, []);

  useEffect(() => {
    return () => { intervalsRef.current.forEach(id => window.clearInterval(id)); };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isConfigured) { setError("Set VITE_API_BASE_URL before submitting jobs"); return; }

    setError(null);
    setWarmupMsg(null);
    setIsSubmitting(true);

    const label = message.trim();
    const n = Math.min(count, MAX_JOBS - jobs.length);
    if (n <= 0) { setError(`Maximum of ${MAX_JOBS} jobs reached`); setIsSubmitting(false); return; }

    const baseCounter = counter;
    setCounter(c => c + n);

    try {
      const initialJobs = await createJobBatch(Array(n).fill(label), (attempt, max) => {
        setWarmupMsg(`Lambda cold start — warming up (retry ${attempt}/${max - 1})…`);
      });
      const tracked: TrackedJob[] = initialJobs.map((data, i) => ({
        counter: baseCounter + i + 1,
        label,
        jobId: data.jobId,
        data,
        error: null
      }));
      setWarmupMsg(null);
      setJobs(prev => [...tracked, ...prev]);
      tracked.forEach(j => { if (j.data?.status !== "COMPLETED") startPolling(j.jobId); });
    } catch (err) {
      setCounter(c => c - n);
      setError((err as Error).message);
    }

    setIsSubmitting(false);
  }

  return (
    <div className="page">
      <main className="card">
        <h1>Serverless Job Runner</h1>
        <p>Submit work from React. API Gateway triggers Lambda, then SNS + SQS process and persist the result.</p>

        <form onSubmit={onSubmit} className="stack">
          <label htmlFor="message">Message</label>
          <div className="input-row">
            <input
              id="message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type work payload"
              required
            />
            <input
              id="count"
              type="number"
              min={1}
              max={MAX_JOBS}
              value={count}
              onChange={e => setCount(Math.max(1, Math.min(MAX_JOBS, Number(e.target.value))))}
              className="count-input"
              title="Number of jobs to create"
            />
          </div>
          <button type="submit" disabled={isSubmitting || !message.trim()}>
            {isSubmitting
              ? "Submitting…"
              : count === 1 ? "Create Job" : `Create ${count} Jobs`}
          </button>
        </form>

        {!isConfigured && <p className="warning">VITE_API_BASE_URL is missing. Add it in frontend/.env.local.</p>}
        {warmupMsg && <p className="warmup"><span className="spinner spinner-xs" />{warmupMsg}</p>}
        {error && <p className="error">{error}</p>}

        {jobs.length > 0 && (
          <section className="job-list">
            <h2 className="job-list-header">
              Jobs <span className="job-count">{jobs.length}</span>
            </h2>
            <div className="job-list-scroll">
              {jobs.map((job, idx) => (
                <div
                  key={job.jobId}
                  className={`job-card ${job.data?.status.toLowerCase() ?? "pending"}`}
                  style={{ animationDelay: `${idx * 35}ms` }}
                >
                  <div className="job-card-header">
                    <span className="job-tag">#{job.counter}</span>
                    <span className="job-label" title={job.label}>{job.label}</span>
                    <span className="job-id">{job.jobId.slice(0, 8)}…</span>
                    {job.data && job.data.status !== "COMPLETED" && <span className="spinner spinner-sm" />}
                  </div>
                  {job.error && <p className="error job-error">{job.error}</p>}
                  {job.data && (
                    <div className="job-timeline">
                      <span className="tl-item tl-pending">
                        <span className="tl-dot" />
                        <span className="tl-label">Pending</span>
                        <span className="tl-time">{formatTs(job.data.createdAt)}</span>
                      </span>
                      {job.data.processingAt && (
                        <span className="tl-item tl-processing">
                          <span className="tl-dot" />
                          <span className="tl-label">Processing</span>
                          <span className="tl-time">{formatTs(job.data.processingAt)}</span>
                        </span>
                      )}
                      {job.data.processedAt && (
                        <span className="tl-item tl-completed">
                          <span className="tl-dot" />
                          <span className="tl-label">Completed</span>
                          <span className="tl-time">{formatTs(job.data.processedAt)}</span>
                        </span>
                      )}
                    </div>
                  )}
                  {job.data?.result && (
                    <p className="job-result"><strong>Result:</strong> {job.data.result}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
