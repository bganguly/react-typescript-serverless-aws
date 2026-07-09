import { FormEvent, useEffect, useRef, useState } from "react";

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
  jobId: string;         // "loading-N" for placeholders
  data: JobResponse | null;
  error: string | null;
  loading: boolean;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const MAX_JOBS = 100;

async function fetchJobsBatch(jobIds: string[]): Promise<JobResponse[]> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds })
  });
  if (!response.ok) throw new Error(`Status poll failed with ${response.status}`);
  return (await response.json()) as JobResponse[];
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

function gridCols(n: number): string {
  if (n === 1)  return 'minmax(auto, 520px)';
  if (n <= 4)   return 'repeat(2, 1fr)';
  if (n <= 9)   return 'repeat(3, 1fr)';
  if (n <= 20)  return 'repeat(4, 1fr)';
  if (n <= 35)  return 'repeat(5, 1fr)';
  return 'repeat(6, 1fr)';
}

export default function App() {
  const [message, setMessage] = useState("Build me a serverless sample");
  const [count, setCount] = useState(1);
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [counter, setCounter] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warmupMsg, setWarmupMsg] = useState<string | null>(null);
  const jobsRef = useRef<TrackedJob[]>([]);
  jobsRef.current = jobs;

  const isConfigured = Boolean(apiBaseUrl);

  // Single shared poller — one Lambda call fetches all in-flight jobs at once
  useEffect(() => {
    const id = window.setInterval(async () => {
      const inFlight = jobsRef.current.filter(
        j => !j.loading && !j.error && j.data?.status !== "COMPLETED"
      );
      if (inFlight.length === 0) return;
      try {
        const updates = await fetchJobsBatch(inFlight.map(j => j.jobId));
        setJobs(prev => prev.map(j => {
          const u = updates.find(r => r.jobId === j.jobId);
          return u ? { ...j, data: u } : j;
        }));
      } catch {
        // silent — retry on next tick
      }
    }, 2000);
    return () => window.clearInterval(id);
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

    // Show placeholder cards immediately so the grid appears on keypress
    const placeholderIds = Array.from({ length: n }, (_, i) => `loading-${baseCounter + i}`);
    const placeholders: TrackedJob[] = placeholderIds.map((id, i) => ({
      counter: baseCounter + i + 1,
      label,
      jobId: id,
      data: null,
      error: null,
      loading: true,
    }));
    setJobs(prev => [...placeholders, ...prev]);

    try {
      const initialJobs = await createJobBatch(Array(n).fill(label), (attempt, max) => {
        setWarmupMsg(`Lambda warming up — retry ${attempt}/${max - 1}…`);
      });
      const tracked: TrackedJob[] = initialJobs.map((data, i) => ({
        counter: baseCounter + i + 1,
        label,
        jobId: data.jobId,
        data,
        error: null,
        loading: false,
      }));
      setWarmupMsg(null);
      // Replace placeholders with real jobs (preserve order)
      setJobs(prev => {
        const withoutPlaceholders = prev.filter(j => !j.loading);
        return [...tracked, ...withoutPlaceholders];
      });
    } catch (err) {
      setJobs(prev => prev.filter(j => !j.loading));
      setCounter(c => c - n);
      setError((err as Error).message);
    }

    setIsSubmitting(false);
  }

  const visibleJobs = jobs.length;

  return (
    <div className={`page${visibleJobs > 0 ? ' has-jobs' : ''}`}>
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

        {visibleJobs > 0 && (
          <section className="job-list">
            <h2 className="job-list-header">
              Jobs <span className="job-count">{visibleJobs}</span>
            </h2>
            <div className="job-list-scroll" style={{ gridTemplateColumns: gridCols(visibleJobs) }}>
              {jobs.map((job, idx) => (
                <div
                  key={job.jobId}
                  className={`job-card ${job.loading ? 'loading' : (job.data?.status.toLowerCase() ?? 'pending')}`}
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  {job.loading ? (
                    <div className="job-card-creating">
                      <span className="spinner spinner-sm" />
                      <span className="job-tag">#{job.counter}</span>
                      <span className="job-label-muted">{job.label}</span>
                    </div>
                  ) : (
                    <>
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
                    </>
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
