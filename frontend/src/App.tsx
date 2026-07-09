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
const MAX_JOBS = 200;

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
  if (n <= 60)  return 'repeat(6, 1fr)';
  if (n <= 100) return 'repeat(8, 1fr)';
  if (n <= 150) return 'repeat(10, 1fr)';
  return 'repeat(12, 1fr)';
}

export default function App() {
  const [message, setMessage] = useState("Build me a serverless sample");
  const [count, setCount] = useState(1);
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warmupMsg, setWarmupMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<'grid' | 'stacked'>('grid');
  const jobsRef = useRef<TrackedJob[]>([]);
  const runStartRef = useRef<number>(0);
  const hoverTimer = useRef<number | null>(null);
  jobsRef.current = jobs;

  const isConfigured = Boolean(apiBaseUrl);

  // Look up live data each render so modal stays fresh during polling
  const hoveredJob = hoveredJobId ? (jobs.find(j => j.jobId === hoveredJobId) ?? null) : null;

  function toggleView() {
    setViewMode(v => v === 'grid' ? 'stacked' : 'grid');
  }

  function showModal(job: TrackedJob, x: number, y: number) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredJobId(job.jobId);
    setMousePos({ x, y });
  }

  function hideModal() {
    hoverTimer.current = window.setTimeout(() => setHoveredJobId(null), 120);
  }

  function cancelHide() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }

  // Record elapsed wall-clock time from submit to last job settling
  useEffect(() => {
    if (elapsed !== null) return;
    const real = jobs.filter(j => !j.loading);
    if (real.length === 0) return;
    if (real.every(j => j.error !== null || j.data?.status === "COMPLETED")) {
      setElapsed(Date.now() - runStartRef.current);
    }
  }, [jobs, elapsed]);

  // Single shared poller — one Lambda call per tick for all in-flight jobs
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
    setElapsed(null);
    setHoveredJobId(null);
    runStartRef.current = Date.now();

    const label = message.trim();
    const n = Math.min(count, MAX_JOBS);

    // Clean slate — instant placeholders before the API round-trip
    const placeholders: TrackedJob[] = Array.from({ length: n }, (_, i) => ({
      counter: i + 1,
      label,
      jobId: `loading-${i}`,
      data: null,
      error: null,
      loading: true,
    }));
    setJobs(placeholders);

    try {
      const initialJobs = await createJobBatch(Array(n).fill(label), (attempt, max) => {
        setWarmupMsg(`Lambda warming up — retry ${attempt}/${max - 1}…`);
      });
      setWarmupMsg(null);
      setJobs(initialJobs.map((data, i) => ({
        counter: i + 1,
        label,
        jobId: data.jobId,
        data,
        error: null,
        loading: false,
      })));
    } catch (err) {
      setJobs([]);
      setError((err as Error).message);
    }

    setIsSubmitting(false);
  }

  const visibleJobs    = jobs.length;
  const realJobs       = jobs.filter(j => !j.loading);
  const inFlight       = realJobs.some(j => !j.error && j.data?.status !== "COMPLETED");
  const isLocked       = isSubmitting || jobs.some(j => j.loading) || inFlight;

  // Stacked view buckets
  const stkPending    = jobs.filter(j => j.loading || (!j.error && j.data?.status === 'PENDING'));
  const stkProcessing = jobs.filter(j => !j.loading && !j.error && j.data?.status === 'PROCESSING');
  const stkDone       = jobs.filter(j => !j.loading && (!!j.error || j.data?.status === 'COMPLETED'));

  // Modal position clamped to viewport
  const modalX = Math.min(mousePos.x + 14, window.innerWidth - 400);
  const modalY = Math.max(8, Math.min(mousePos.y - 20, window.innerHeight - 340));

  function FloorChip({ job, extra }: { job: TrackedJob; extra?: string }) {
    return (
      <div
        className={`stk-floor${extra ? ` ${extra}` : ''}`}
        onMouseEnter={job.loading ? undefined : (e) => showModal(job, e.clientX, e.clientY)}
        onMouseLeave={job.loading ? undefined : hideModal}
      >
        {(job.loading || job.data?.status === 'PROCESSING') && (
          <span className="spinner spinner-sm" />
        )}
        <span className="job-tag">#{job.counter}</span>
        <span className="stk-floor-msg">{job.error ?? job.label}</span>
      </div>
    );
  }

  return (
    <div className={`page${visibleJobs > 0 ? ' has-jobs' : ''}`}>
      <main className="card">
        <div className="card-title-row">
          <h1>Serverless Job Runner</h1>
          <button className="view-toggle" type="button" onClick={toggleView}>
            {viewMode === 'grid' ? '☰ Stack' : '⊞ Grid'}
          </button>
        </div>
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
          <button type="submit" disabled={isLocked || !message.trim()}>
            {isSubmitting
              ? "Submitting…"
              : isLocked ? "Running…"
              : count === 1 ? "Create Job" : `Create ${count} Jobs`}
          </button>
        </form>

        {!isConfigured && <p className="warning">VITE_API_BASE_URL is missing. Add it in frontend/.env.local.</p>}
        {warmupMsg && <p className="warmup"><span className="spinner spinner-xs" />{warmupMsg}</p>}
        {error && <p className="error">{error}</p>}

        {visibleJobs > 0 && (
          <section className="job-list">
            {(() => {
              const submitted  = realJobs.length;
              const pending    = jobs.filter(j => j.data?.status === "PENDING").length;
              const processing = jobs.filter(j => j.data?.status === "PROCESSING").length;
              const completed  = jobs.filter(j => j.data?.status === "COMPLETED").length;
              const errored    = realJobs.filter(j => j.error).length;
              const allSettled = submitted > 0 && !inFlight && !jobs.some(j => j.loading);
              const elapsedStr = elapsed != null ? ` · ${(elapsed / 1000).toFixed(3)}s` : '';
              return (
                <h2 className="job-list-header">
                  <span className="jstat">submitted <b>{submitted}</b></span>
                  <span className="jstat-sep">·</span>
                  <span className="jstat jstat-pending">pending <b>{pending}</b></span>
                  <span className="jstat-sep">·</span>
                  <span className="jstat jstat-processing">processing <b>{processing}</b></span>
                  <span className="jstat-sep">·</span>
                  <span className="jstat jstat-completed">completed <b>{completed}</b></span>
                  <span className="run-status">
                    {(jobs.some(j => j.loading) || inFlight) && <span className="spinner spinner-sm" />}
                    {allSettled && errored === 0 && <span className="run-ok">✓ all passed{elapsedStr}</span>}
                    {allSettled && errored > 0  && <span className="run-fail">✗ {errored} failed{elapsedStr}</span>}
                  </span>
                </h2>
              );
            })()}

            {viewMode === 'stacked' ? (
              <div className="stk-board">
                {/* PENDING */}
                <div className="stk-col stk-col-pending">
                  <div className="stk-col-hdr">
                    Pending <b>{stkPending.length}</b>
                  </div>
                  <div className="stk-floors">
                    {stkPending.map(j => (
                      <FloorChip key={j.jobId} job={j} extra={j.loading ? 'stk-floor-creating' : undefined} />
                    ))}
                  </div>
                </div>
                {/* PROCESSING */}
                <div className="stk-col stk-col-processing">
                  <div className="stk-col-hdr">
                    Processing <b>{stkProcessing.length}</b>
                  </div>
                  <div className="stk-floors">
                    {stkProcessing.map(j => (
                      <FloorChip key={j.jobId} job={j} />
                    ))}
                  </div>
                </div>
                {/* COMPLETED / ERRORED */}
                <div className="stk-col stk-col-completed">
                  <div className="stk-col-hdr">
                    Done <b>{stkDone.length}</b>
                  </div>
                  <div className="stk-floors">
                    {stkDone.map(j => (
                      <FloorChip key={j.jobId} job={j} extra={j.error ? 'stk-floor-error' : 'stk-floor-done'} />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="job-list-scroll" style={{ gridTemplateColumns: gridCols(visibleJobs) }}>
                {jobs.map((job, idx) => (
                  <div
                    key={job.jobId}
                    className={`job-card ${job.loading ? 'loading' : (job.data?.status.toLowerCase() ?? 'pending')}`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    onMouseEnter={job.loading ? undefined : (e) => showModal(job, e.clientX, e.clientY)}
                    onMouseLeave={job.loading ? undefined : hideModal}
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
            )}
          </section>
        )}
      </main>

      {/* Hover detail modal — outside .card so it isn't clipped */}
      {hoveredJob && !hoveredJob.loading && (() => {
        const status = hoveredJob.data?.status ?? 'PENDING';
        return (
          <div
            className="job-modal"
            style={{ top: modalY, left: modalX }}
            onMouseEnter={cancelHide}
            onMouseLeave={hideModal}
          >
            <div className="jm-header">
              <span className="job-tag">#{hoveredJob.counter}</span>
              <span className={`jm-badge jm-${status.toLowerCase()}`}>{status}</span>
            </div>
            <p className="jm-msg">{hoveredJob.label}</p>
            <p className="jm-id">{hoveredJob.jobId}</p>
            {hoveredJob.error && <p className="jm-err">{hoveredJob.error}</p>}
            {hoveredJob.data && (
              <div className="job-timeline jm-tl">
                <span className="tl-item tl-pending">
                  <span className="tl-dot" />
                  <span className="tl-label">Pending</span>
                  <span className="tl-time">{formatTs(hoveredJob.data.createdAt)}</span>
                </span>
                {hoveredJob.data.processingAt && (
                  <span className="tl-item tl-processing">
                    <span className="tl-dot" />
                    <span className="tl-label">Processing</span>
                    <span className="tl-time">{formatTs(hoveredJob.data.processingAt)}</span>
                  </span>
                )}
                {hoveredJob.data.processedAt && (
                  <span className="tl-item tl-completed">
                    <span className="tl-dot" />
                    <span className="tl-label">Completed</span>
                    <span className="tl-time">{formatTs(hoveredJob.data.processedAt)}</span>
                  </span>
                )}
              </div>
            )}
            {hoveredJob.data?.result && (
              <p className="jm-result"><strong>Result:</strong> {hoveredJob.data.result}</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}
