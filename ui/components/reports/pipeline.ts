// A CI run from `gh run view --json name,displayTitle,status,conclusion,url,
// headBranch,headSha,createdAt,updatedAt,jobs`, or an inline list of stages
// [{name, status, duration?, url?, jobs?: [{name, status, duration?}]}]. Pure.
import { duration, epoch, isObj, list, num, str, tryJson, type Obj } from "./common";

export type RunStatus = "failure" | "running" | "queued" | "cancelled" | "success" | "skipped";
export interface Step {
  name: string;
  status: RunStatus;
  /** Display text: "1m 12s". */
  time?: string;
  url?: string;
}
export interface Job extends Step {
  steps: Step[];
}
export interface PipelineRun {
  title?: string;
  workflow?: string;
  status: RunStatus;
  url?: string;
  branch?: string;
  sha?: string;
  event?: string;
  time?: string;
  jobs: Job[];
}

const USAGE = "Pipeline reads gh run view --json ... (with jobs) or [{name, status, jobs?}]";

/** Maps GitHub's status + conclusion, or a hand-written word, to one status. */
export function runStatus(status: unknown, conclusion?: unknown): RunStatus {
  const s = String(status ?? "").toLowerCase();
  const c = String(conclusion ?? "").toLowerCase();
  if (s && s !== "completed") {
    if (/^(in_progress|running|started|active)$/.test(s)) return "running";
    if (/^(queued|waiting|requested|pending|expected)$/.test(s)) return "queued";
  }
  const word = c || s;
  if (/^(success|succeeded|passed|pass|done|ok|completed)$/.test(word)) return "success";
  if (/^(failure|failed|fail|timed_out|startup_failure|action_required|error)$/.test(word)) return "failure";
  if (/^(cancelled|canceled|stale)$/.test(word)) return "cancelled";
  if (/^(skipped|neutral)$/.test(word)) return "skipped";
  if (/^(in_progress|running)$/.test(word)) return "running";
  return "queued";
}

/** Worst first: any failure fails the run; else running, else queued. */
export function overall(statuses: RunStatus[]): RunStatus {
  for (const s of ["failure", "running", "queued", "cancelled", "success"] as const) if (statuses.includes(s)) return s;
  return "skipped";
}

const span = (start: unknown, end: unknown) => {
  const a = epoch(start);
  const b = epoch(end);
  return a !== undefined && b !== undefined && b >= a ? duration(b - a) : undefined;
};

/** A hand-written duration: seconds as a number, or text as given ("4m 14s"). */
const given = (value: unknown) => (num(value) !== undefined ? duration(num(value)! * 1000) : str(value));

export function parsePipeline(input: string | unknown[]): PipelineRun {
  if (Array.isArray(input)) return fromStages(input);
  const json = tryJson(input.trim());
  if (Array.isArray(json)) return fromStages(json);
  if (isObj(json) && Array.isArray(json.jobs)) return fromGh(json);
  throw new Error(USAGE);
}

function fromGh(run: Obj): PipelineRun {
  const jobs = list(run.jobs)
    .filter(isObj)
    .map(
      (j): Job => ({
        name: str(j.name) ?? "Job",
        status: runStatus(j.status, j.conclusion),
        time: span(j.startedAt, j.completedAt),
        url: str(j.url),
        steps: list(j.steps)
          .filter(isObj)
          .map((s) => ({ name: str(s.name) ?? "Step", status: runStatus(s.status, s.conclusion), time: span(s.startedAt, s.completedAt) })),
      }),
    );
  return {
    title: str(run.displayTitle),
    workflow: str(run.workflowName) ?? str(run.name),
    status: run.status || run.conclusion ? runStatus(run.status, run.conclusion) : overall(jobs.map((j) => j.status)),
    url: str(run.url),
    branch: str(run.headBranch),
    sha: str(run.headSha),
    event: str(run.event),
    time: run.status === "completed" ? span(run.startedAt ?? run.createdAt, run.updatedAt) : undefined,
    jobs,
  };
}

function fromStages(rows: unknown[]): PipelineRun {
  const jobs = rows.filter(isObj).flatMap((row): Job[] => {
    const name = str(row.name);
    if (!name) return [];
    const steps = list(row.jobs ?? row.steps)
      .filter(isObj)
      .flatMap((s) => (str(s.name) ? [{ name: str(s.name)!, status: runStatus(s.status), time: given(s.duration), url: str(s.url) }] : []));
    const status = row.status === undefined && steps.length ? overall(steps.map((s) => s.status)) : runStatus(row.status);
    return [{ name, status, time: given(row.duration), url: str(row.url), steps }];
  });
  return { status: overall(jobs.map((j) => j.status)), jobs };
}
