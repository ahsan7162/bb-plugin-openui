// Reports: tool output an agent just produced (tests, lint, coverage, CI,
// benchmarks, timings, provenance), read from a thread file or given inline.
// Parsing lives in ./reports/*.ts (pure, tested); this file only draws.
import type { ReactNode } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { z } from "zod/v4";
import {
  Ban,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  Info,
  LoaderCircle,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, LoadedView, fmt, useStreaming } from "./kit";
import type { ExtraGroup } from "./types";
import { useThreadFile, type Loaded } from "../data";
import { countWords, duration } from "./reports/common";
import { parseTests, type TestCase, type TestStatus } from "./reports/tests";
import { parseFindings, type Finding, type Severity } from "./reports/findings";
import { METRICS, parseCoverage, type Metric, type MetricName } from "./reports/coverage";
import { parseDependencies, VULN_LEVELS, type Gap, type VulnLevel } from "./reports/dependencies";
import { parsePipeline, type Job, type RunStatus, type Step } from "./reports/pipeline";
import { changeWords, parseBenchmark, type Comparison, type Verdict } from "./reports/benchmark";
import { parseWaterfall } from "./reports/waterfall";
import { parseProvenance, type StageStatus } from "./reports/provenance";

// ---------- shared pieces ----------

type Tone = "good" | "bad" | "warn" | "info" | "neutral" | "accent";
type Look = { icon: LucideIcon; tone: Tone; word: string };

/** State is an icon shape plus a word (its accessible name); colour only repeats it. */
function StatusIcon({ icon: Icon, tone, word }: Look) {
  return <Icon className="bbui-reports-icon" data-tone={tone} size={14} strokeWidth={1.75} role="img" aria-label={word} />;
}

/** A skeleton in the shape of a report: a lede, an optional row of figures, then list rows. */
function Shape({ label, figures = 0, rows = 4 }: { label: string; figures?: number; rows?: number }) {
  return (
    <div className="bbui-skeleton bbui-reports-shape" role="status" aria-label={`Loading ${label}`}>
      <span style={{ width: "40%" }} />
      {figures > 0 ? (
        <div className="bbui-reports-shape-figures">
          {Array.from({ length: figures }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="bbui-reports-shape-row" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

type ViewProps<T> = {
  label: string;
  parse: (input: string | unknown[]) => T;
  isEmpty: (value: T) => boolean;
  empty: { title: string; hint?: string };
  skeleton: ReactNode;
  children: (value: T) => ReactNode;
};

/**
 * The frame every file-backed report shares: a heading, then the four states of its data.
 * `source` is a thread file path or an inline list; inline lists skip the read.
 * Nothing draws until streaming ends, so a half-written path is never fetched.
 */
function Report<T>({ title, source, ...view }: ViewProps<T> & { title?: string; source: unknown }) {
  const streaming = useStreaming();
  const path = typeof source === "string" ? source.trim() : "";
  let body: ReactNode;
  // Charts and folds wait for the stream to end (DESIGN): inline rows too.
  if (streaming) body = view.skeleton;
  else if (Array.isArray(source)) body = <View {...view} loaded={{ state: "ready", value: "" }} inline={source} />;
  else if (path) body = <FileView {...view} path={path} />;
  else body = <EmptyState title={`No ${view.label} to show`} hint="Pass a file path from this thread, or the rows inline." />;
  return (
    <section className="bbui bbui-reports" aria-label={title ?? view.label}>
      {title ? <h3 className="bbui-head bbui-reports-title">{title}</h3> : null}
      {body}
    </section>
  );
}

/** Its own component so the file read (a hook) only mounts for file sources. */
function FileView<T>({ path, ...view }: ViewProps<T> & { path: string }) {
  return <View {...view} loaded={useThreadFile(path)} />;
}

function View<T>({ label, parse, isEmpty, empty, skeleton, children, loaded, inline }: ViewProps<T> & { loaded: Loaded<string>; inline?: unknown[] }) {
  return (
    <LoadedView
      loaded={loaded}
      parse={(text) => parse(inline ?? text)}
      isEmpty={isEmpty}
      empty={empty}
      errorTitle={`Could not show the ${label}`}
      skeleton={skeleton}
    >
      {children}
    </LoadedView>
  );
}

function Lede({ look, children }: { look: Look; children: ReactNode }) {
  return (
    <p className="bbui-reports-lede">
      <StatusIcon {...look} />
      <span>{children}</span>
    </p>
  );
}

function Where({ file, line }: { file?: string; line?: number }) {
  if (!file) return null;
  return <span className="bbui-mono bbui-reports-where">{line ? `${file}:${line}` : file}</span>;
}

/** A collapsed list ("41 passed"), opened on demand. */
function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="bbui-reports-fold">
      <summary className="bbui-reports-summary">
        <ChevronRight className="bbui-reports-chevron" size={14} strokeWidth={1.75} aria-hidden="true" />
        {summary}
      </summary>
      {children}
    </details>
  );
}

/** Shows the first `max` items and folds the rest. */
function Capped<T>({ items, max, more, render }: { items: T[]; max: number; more: (n: number) => string; render: (items: T[]) => ReactNode }) {
  if (items.length <= max + 2) return <>{render(items)}</>;
  return (
    <>
      {render(items.slice(0, max))}
      <Fold summary={more(items.length - max)}>{render(items.slice(max))}</Fold>
    </>
  );
}

/** Never rounds up to 100%: 99.96 shows as 99.9, since a line is still uncovered. */
const pct = (value: number) => (value >= 100 || value === 0 ? `${fmt(value, { decimals: 0 })}%` : `${fmt(Math.min(99.9, Math.floor(value * 10) / 10), { decimals: 1 })}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A slim bar from zero; the data end is rounded, the zero end square. */
function Bar({ value, max, tone }: { value: number; max: number; tone?: "muted" | "bad" }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <svg className="bbui-reports-bar" aria-hidden="true" focusable="false">
      <rect className="bbui-reports-bar-fill" data-tone={tone} width={`${w}%`} height="100%" rx="2" />
      {w > 2 ? <rect className="bbui-reports-bar-fill" data-tone={tone} width="4" height="100%" /> : null}
    </svg>
  );
}

// ---------- Tests ----------

const TEST_LOOK: Record<TestStatus, Look> = {
  failed: { icon: CircleX, tone: "bad", word: "Failed" },
  passed: { icon: CircleCheck, tone: "good", word: "Passed" },
  skipped: { icon: CircleMinus, tone: "neutral", word: "Skipped" },
};

function TestRow({ test }: { test: TestCase }) {
  return (
    <li className="bbui-reports-row">
      <StatusIcon {...TEST_LOOK[test.status]} />
      <div className="bbui-reports-main">
        <div className="bbui-reports-line">
          <span className="bbui-reports-name">{test.name}</span>
          {test.ms !== undefined && test.status !== "skipped" ? <span className="bbui-label">{duration(test.ms)}</span> : null}
        </div>
        <Where file={test.file} line={test.line} />
        {test.message && test.status === "failed" ? <pre className="bbui-mono bbui-reports-pre">{test.message}</pre> : null}
        {test.message && test.status === "skipped" ? <span className="bbui-label">{test.message}</span> : null}
      </div>
    </li>
  );
}

const testList = (label: string) => (tests: TestCase[]) => (
  <ol className="bbui-reports-list" aria-label={label}>
    {tests.map((t, i) => (
      <TestRow key={i} test={t} />
    ))}
  </ol>
);

const testRow = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  message: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
});

const Tests = defineComponent({
  name: "Tests",
  description: "Test results, failures first with message and file:line. source: a thread file (vitest/jest --json, JUnit XML) or rows inline.",
  props: z.object({ source: z.union([z.string(), z.array(testRow)]), title: z.string().optional() }),
  component: ({ props }) => (
    <Report
      title={props.title ?? "Test results"}
      label="test results"
      source={props.source}
      parse={parseTests}
      isEmpty={(run) => run.cases.length === 0}
      empty={{ title: "No tests in this report", hint: "The file parsed but held no test cases. Run the reporter with --json or JUnit output." }}
      skeleton={<Shape label="test results" rows={5} />}
    >
      {(run) => {
        const { failed, passed, skipped } = run.counts;
        const total = run.cases.length;
        const pick = (s: TestStatus) => run.cases.filter((c) => c.status === s);
        return (
          <>
            <Lede look={failed ? TEST_LOOK.failed : TEST_LOOK.passed}>
              {failed ? `${failed} of ${total} failed` : `All ${plural(total, "test")} passed`}
              <span className="bbui-label">{failed ? `, ${countWords([[passed, "passed"], [skipped, "skipped"]])}` : skipped ? `, ${skipped} skipped` : ""}</span>
            </Lede>
            {failed ? testList("Failed tests")(pick("failed")) : null}
            {passed ? <Fold summary={`${passed} passed`}>{testList("Passed tests")(pick("passed"))}</Fold> : null}
            {skipped ? <Fold summary={`${skipped} skipped`}>{testList("Skipped tests")(pick("skipped"))}</Fold> : null}
          </>
        );
      }}
    </Report>
  ),
});

// ---------- Findings ----------

const SEVERITY_LOOK: Record<Severity, Look> = {
  error: { icon: CircleX, tone: "bad", word: "Error" },
  warning: { icon: TriangleAlert, tone: "warn", word: "Warning" },
  info: { icon: Info, tone: "neutral", word: "Note" },
};

function FindingRow({ finding: f }: { finding: Finding }) {
  const look = SEVERITY_LOOK[f.severity];
  const meta = [look.word, f.line ? `line ${f.line}` : null, f.status ?? null].filter(Boolean).join(", ");
  return (
    <li className="bbui-reports-row">
      <StatusIcon {...look} />
      <div className="bbui-reports-main">
        <span className="bbui-reports-name">{f.title}</span>
        <div className="bbui-reports-line bbui-reports-meta">
          <span className="bbui-label">{meta}</span>
          {f.rule ? <span className="bbui-mono bbui-reports-where">{f.rule}</span> : null}
        </div>
        {f.detail ? <pre className="bbui-mono bbui-reports-pre">{f.detail}</pre> : null}
        {f.fix ? <span className="bbui-reports-fix">Fix: {f.fix}</span> : null}
      </div>
    </li>
  );
}

const findingRow = z.object({
  severity: z.enum(["error", "warning", "info"]),
  title: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  detail: z.string().optional(),
  fix: z.string().optional(),
  status: z.string().optional(),
});

const Findings = defineComponent({
  name: "Findings",
  description: "Lint, type-check or review findings grouped by file. source: a thread file (eslint/biome/oxlint/ruff JSON, SARIF, tsc --pretty false) or rows inline.",
  props: z.object({ source: z.union([z.string(), z.array(findingRow)]), title: z.string().optional() }),
  component: ({ props }) => (
    <Report
      title={props.title ?? "Findings"}
      label="findings"
      source={props.source}
      parse={parseFindings}
      isEmpty={(r) => r.findings.length === 0}
      empty={{ title: "No problems found", hint: "The report lists no findings." }}
      skeleton={<Shape label="findings" rows={5} />}
    >
      {(r) => (
        <>
          <Lede look={SEVERITY_LOOK[r.counts.error ? "error" : r.counts.warning ? "warning" : "info"]}>
            {countWords([
              [r.counts.error, r.counts.error === 1 ? "error" : "errors"],
              [r.counts.warning, r.counts.warning === 1 ? "warning" : "warnings"],
              [r.counts.info, r.counts.info === 1 ? "note" : "notes"],
            ])}
            <span className="bbui-label">{r.files.some((g) => g.file) ? ` in ${plural(r.files.length, "file")}` : ""}</span>
          </Lede>
          <Capped
            items={r.files}
            max={8}
            more={(n) => `${plural(n, "more file")}`}
            render={(groups) => (
              <ul className="bbui-reports-groups">
                {groups.map((g, i) => (
                  <li key={i} className="bbui-reports-group">
                    <div className="bbui-reports-line bbui-reports-group-head">
                      <span className="bbui-mono bbui-reports-path">{g.file ?? "No file"}</span>
                      <span className="bbui-label">{plural(g.findings.length, "finding")}</span>
                    </div>
                    <ol className="bbui-reports-list">
                      {g.findings.map((f, j) => (
                        <FindingRow key={j} finding={f} />
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          />
        </>
      )}
    </Report>
  ),
});

// ---------- Coverage ----------

const METRIC_WORD: Record<MetricName, string> = { lines: "Lines", branches: "Branches", functions: "Functions", statements: "Statements" };

function MetricFigure({ name, metric }: { name: MetricName; metric?: Metric }) {
  return (
    <div className="bbui-reports-figure">
      <dt className="bbui-label">{METRIC_WORD[name]}</dt>
      <dd className={metric ? "bbui-figure" : "bbui-label"}>{metric ? pct(metric.pct) : "Not reported"}</dd>
      {metric ? (
        <dd className="bbui-label">{metric.total !== undefined ? `${fmt(metric.covered!, { decimals: 0 })} of ${fmt(metric.total, { decimals: 0 })}` : "Mean of files"}</dd>
      ) : null}
    </div>
  );
}

const coverageRow = z.object({
  file: z.string(),
  lines: z.number(),
  branches: z.number().optional(),
  functions: z.number().optional(),
});

const Coverage = defineComponent({
  name: "Coverage",
  description: "Code coverage totals and files worst first. source: a thread file (lcov.info, coverage-summary.json) or rows inline with percentages.",
  props: z.object({ source: z.union([z.string(), z.array(coverageRow)]) }),
  component: ({ props }) => (
    <Report
      title="Coverage"
      label="coverage"
      source={props.source}
      parse={parseCoverage}
      isEmpty={(r) => r.files.length === 0 && Object.keys(r.totals).length === 0}
      empty={{ title: "No coverage in this report", hint: "Run the tests with coverage on (lcov or json-summary reporter) and pass that file." }}
      skeleton={<Shape label="coverage" figures={4} rows={5} />}
    >
      {(r) => {
        const metricFor = (f: (typeof r.files)[number]) => METRICS.map((m) => [m, f.metrics[m]] as const).find(([, v]) => v !== undefined);
        return (
          <>
            <dl className="bbui-reports-figures">
              {METRICS.map((m) => (
                <MetricFigure key={m} name={m} metric={r.totals[m]} />
              ))}
            </dl>
            {r.files.length ? (
              <Capped
                items={r.files}
                max={10}
                more={(n) => plural(n, "more file")}
                render={(files) => (
                  <ol className="bbui-reports-list" aria-label="Files, least covered first">
                    {files.map((f, i) => {
                      const [name, metric] = metricFor(f) ?? ["lines", undefined];
                      return (
                        <li key={i} className="bbui-reports-meter">
                          <span className="bbui-mono bbui-reports-path">{f.file}</span>
                          <Bar value={metric?.pct ?? 0} max={100} />
                          <span className="bbui-reports-num" aria-label={metric ? `${METRIC_WORD[name]} ${pct(metric.pct)}` : "Not measured"}>
                            {metric ? pct(metric.pct) : "-"}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              />
            ) : null}
          </>
        );
      }}
    </Report>
  ),
});

// ---------- Dependencies ----------

const VULN_LOOK: Record<VulnLevel, Look> = {
  critical: { icon: ShieldAlert, tone: "bad", word: "Critical" },
  high: { icon: ShieldAlert, tone: "bad", word: "High" },
  moderate: { icon: ShieldAlert, tone: "warn", word: "Moderate" },
  low: { icon: ShieldAlert, tone: "neutral", word: "Low" },
  info: { icon: ShieldAlert, tone: "neutral", word: "Info" },
};
const GAP_WORD: Record<Gap, string> = { major: "Major", minor: "Minor", patch: "Patch", none: "Current", missing: "Not installed" };

const Dependencies = defineComponent({
  name: "Dependencies",
  description: "Outdated packages by major/minor/patch gap and vulnerabilities by severity. source: a thread file (npm outdated/audit --json, pip list --outdated JSON) or rows inline.",
  props: z.object({ source: z.union([z.string(), z.array(z.object({ name: z.string(), current: z.string(), latest: z.string() }))]) }),
  component: ({ props }) => (
    <Report
      title="Dependencies"
      label="dependency report"
      source={props.source}
      parse={parseDependencies}
      isEmpty={(r) => r.outdated.length === 0 && r.vulnerabilities.length === 0}
      empty={{ title: "Everything is up to date", hint: "No outdated packages and no known vulnerabilities in this report." }}
      skeleton={<Shape label="dependency report" rows={6} />}
    >
      {(r) => {
        const gaps = (g: Gap) => r.outdated.filter((d) => d.gap === g).length;
        const levels = VULN_LEVELS.map((l) => [r.vulnerabilities.filter((v) => v.severity === l).length, l] as [number, string]);
        return (
          <>
            {r.vulnerabilities.length ? (
              <>
                <Lede look={VULN_LOOK[r.vulnerabilities[0]!.severity]}>
                  {plural(r.vulnerabilities.length, "vulnerability", "vulnerabilities")}
                  <span className="bbui-label">{`: ${countWords(levels)}`}</span>
                </Lede>
                <Capped
                  items={r.vulnerabilities}
                  max={8}
                  more={(n) => plural(n, "more vulnerability", "more vulnerabilities")}
                  render={(vulns) => (
                    <ol className="bbui-reports-list" aria-label="Vulnerabilities, most severe first">
                      {vulns.map((v, i) => (
                        <li key={i} className="bbui-reports-row">
                          <StatusIcon {...VULN_LOOK[v.severity]} />
                          <div className="bbui-reports-main">
                            <div className="bbui-reports-line">
                              <span className="bbui-mono bbui-reports-name">{v.name}</span>
                              <span className="bbui-label">{[VULN_LOOK[v.severity].word, v.direct === false ? "indirect" : null].filter(Boolean).join(", ")}</span>
                            </div>
                            {v.title ? v.url ? <UrlLink href={v.url} className="bbui-reports-link">{v.title}</UrlLink> : <span>{v.title}</span> : null}
                            {v.range ? <span className="bbui-label">Affects {v.range}</span> : null}
                            {v.fix ? <span className="bbui-reports-fix">Fix: {v.fix}</span> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                />
              </>
            ) : null}
            {r.outdated.length ? (
              <>
                <Lede look={{ icon: CircleAlert, tone: gaps("major") || gaps("missing") ? "warn" : "neutral", word: "Outdated" }}>
                  {`${r.outdated.length} outdated`}
                  <span className="bbui-label">{`: ${countWords([[gaps("missing"), "not installed"], [gaps("major"), "major"], [gaps("minor"), "minor"], [gaps("patch"), "patch"]])}`}</span>
                </Lede>
                <div className="bbui-reports-scroll">
                  <table className="bbui-reports-table">
                    <thead>
                      <tr>
                        <th scope="col">Package</th>
                        <th scope="col">Current</th>
                        <th scope="col">Latest</th>
                        <th scope="col">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.outdated.map((d, i) => (
                        <tr key={i}>
                          <td className="bbui-mono bbui-reports-path">{d.name}</td>
                          <td className="bbui-mono">{d.current ?? "-"}</td>
                          <td className="bbui-mono">{d.latest ?? "-"}</td>
                          <td data-gap={d.gap}>{GAP_WORD[d.gap]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        );
      }}
    </Report>
  ),
});

// ---------- Pipeline ----------

const RUN_LOOK: Record<RunStatus, Look> = {
  failure: { icon: CircleX, tone: "bad", word: "Failed" },
  running: { icon: LoaderCircle, tone: "accent", word: "Running" },
  queued: { icon: CircleDashed, tone: "neutral", word: "Queued" },
  cancelled: { icon: Ban, tone: "neutral", word: "Cancelled" },
  success: { icon: CircleCheck, tone: "good", word: "Passed" },
  skipped: { icon: CircleMinus, tone: "neutral", word: "Skipped" },
};

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="bbui-reports-list bbui-reports-steps">
      {steps.map((s, i) => (
        <li key={i} className="bbui-reports-row">
          <StatusIcon {...RUN_LOOK[s.status]} />
          <div className="bbui-reports-line">
            <span className="bbui-reports-name">{s.name}</span>
            <span className="bbui-label">{s.time ?? RUN_LOOK[s.status].word}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function JobRow({ job }: { job: Job }) {
  const look = RUN_LOOK[job.status];
  const open = job.status === "failure" || job.status === "running";
  return (
    <li className="bbui-reports-row">
      <StatusIcon {...look} />
      <div className="bbui-reports-main">
        <div className="bbui-reports-line">
          {job.url ? (
            <UrlLink href={job.url} className="bbui-reports-link bbui-reports-name">
              {job.name}
            </UrlLink>
          ) : (
            <span className="bbui-reports-name">{job.name}</span>
          )}
          <span className="bbui-label">{[look.word, job.time].filter(Boolean).join(", ")}</span>
        </div>
        {job.steps.length ? (
          open ? (
            <StepList steps={job.steps} />
          ) : (
            <Fold summary={plural(job.steps.length, "step")}>
              <StepList steps={job.steps} />
            </Fold>
          )
        ) : null}
      </div>
    </li>
  );
}

const Pipeline = defineComponent({
  name: "Pipeline",
  description: "A CI run: jobs and steps with status and durations, failures open. source: a thread file (gh run view --json ...,jobs) or stages inline (duration in seconds); url links the run.",
  props: z.object({
    source: z.union([
      z.string(),
      z.array(
        z.object({
          name: z.string(),
          status: z.enum(["passed", "failed", "running", "queued", "skipped", "cancelled"]),
          duration: z.union([z.number(), z.string()]).optional(),
          jobs: z.array(z.object({ name: z.string(), status: z.string(), duration: z.union([z.number(), z.string()]).optional() })).optional(),
        }),
      ),
    ]),
    url: z.string().optional(),
  }),
  component: ({ props }) => (
    <Report
      label="pipeline"
      source={props.source}
      parse={parsePipeline}
      isEmpty={(run) => run.jobs.length === 0}
      empty={{ title: "No jobs in this run", hint: "Ask gh for them: gh run view <id> --json name,status,conclusion,url,jobs" }}
      skeleton={<Shape label="pipeline" rows={5} />}
    >
      {(run) => {
        const look = RUN_LOOK[run.status];
        const url = run.url ?? props.url;
        const failed = run.jobs.filter((j) => j.status === "failure").length;
        return (
          <>
            <div className="bbui-reports-line">
              <h3 className="bbui-head bbui-reports-title">{run.workflow ?? "Pipeline"}</h3>
              {url ? (
                <UrlLink href={url} className="bbui-reports-link bbui-reports-out">
                  Open run
                  <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                </UrlLink>
              ) : null}
            </div>
            {run.title ? <p className="bbui-reports-sub">{run.title}</p> : null}
            <Lede look={look}>
              {failed ? `${look.word}: ${failed} of ${plural(run.jobs.length, "job")}` : `${look.word}, ${plural(run.jobs.length, "job")}`}
              <span className="bbui-label">{run.time ? ` in ${run.time}` : ""}</span>
            </Lede>
            {run.branch || run.sha ? (
              <p className="bbui-reports-line bbui-reports-meta">
                {run.branch ? <span className="bbui-mono bbui-reports-where">{run.branch}</span> : null}
                {run.sha ? <span className="bbui-mono bbui-reports-where">{run.sha.slice(0, 7)}</span> : null}
                {run.event ? <span className="bbui-label">{run.event.replace(/_/g, " ")}</span> : null}
              </p>
            ) : null}
            <ol className="bbui-reports-list" aria-label="Jobs">
              {run.jobs.map((j, i) => (
                <JobRow key={i} job={j} />
              ))}
            </ol>
          </>
        );
      }}
    </Report>
  ),
});

// ---------- Benchmark ----------

const VERDICT_LOOK: Record<Verdict, Look> = {
  better: { icon: CircleCheck, tone: "good", word: "Better" },
  worse: { icon: CircleAlert, tone: "bad", word: "Worse" },
  same: { icon: CircleMinus, tone: "neutral", word: "No change" },
  new: { icon: CircleDashed, tone: "neutral", word: "New" },
};

/** Seconds in the unit a reader expects: 9.1 ms, 1.42 s. */
const seconds = (s: number) => (s < 1e-3 ? `${fmt(s * 1e6, { decimals: 0 })} µs` : s < 1 ? `${fmt(s * 1e3, { decimals: 1 })} ms` : `${fmt(s, { decimals: 2 })} s`);

function CompareRow({ row, max, unit }: { row: Comparison; max: number; unit?: string }) {
  const look = VERDICT_LOOK[row.verdict];
  const value = (n: number) => fmt(n, { unit });
  return (
    <li className="bbui-reports-row">
      <StatusIcon {...look} />
      <div className="bbui-reports-main">
        <div className="bbui-reports-line">
          <span className="bbui-reports-name">{row.name}</span>
          <span>
            {changeWords(row, unit)}
            <span className="bbui-label">{row.verdict === "better" || row.verdict === "worse" ? `, ${look.word.toLowerCase()}` : ""}</span>
          </span>
        </div>
        <div className="bbui-reports-pair">
          <span className="bbui-label">Before</span>
          <Bar value={row.before} max={max} tone="muted" />
          <span className="bbui-reports-num">{value(row.before)}</span>
          <span className="bbui-label">After</span>
          <Bar value={row.after} max={max} />
          <span className="bbui-reports-num">{value(row.after)}</span>
        </div>
      </div>
    </li>
  );
}

const Benchmark = defineComponent({
  name: "Benchmark",
  description: "Before/after measurements with the change in words, judged by `better` (default lower). source: rows inline or a thread file (hyperfine --export-json).",
  props: z.object({
    source: z.union([
      z.string(),
      z.array(z.object({ name: z.string(), before: z.number(), after: z.number(), better: z.enum(["lower", "higher"]).optional() })),
    ]),
    unit: z.string().optional(),
  }),
  component: ({ props }) => (
    <Report
      title="Benchmark"
      label="benchmark"
      source={props.source}
      parse={parseBenchmark}
      isEmpty={(r) => (r.kind === "compare" ? r.rows.length === 0 : r.runs.length === 0)}
      empty={{ title: "No measurements in this report", hint: "Give rows with a name, before and after, or a hyperfine --export-json file." }}
      skeleton={<Shape label="benchmark" rows={4} />}
    >
      {(r) => {
        if (r.kind === "ranked") {
          const max = Math.max(...r.runs.map((x) => x.mean));
          return (
            <>
              <Lede look={VERDICT_LOOK.better}>
                {`${r.runs[0]!.name} is fastest`}
                <span className="bbui-label">{`, ${seconds(r.runs[0]!.mean)} mean`}</span>
              </Lede>
              <ol className="bbui-reports-list" aria-label="Commands, fastest first">
                {r.runs.map((run, i) => (
                  <li key={i} className="bbui-reports-row">
                    <StatusIcon {...(run.failed ? { icon: CircleX, tone: "bad", word: "Exited with an error" } : i === 0 ? VERDICT_LOOK.better : VERDICT_LOOK.same)} />
                    <div className="bbui-reports-main">
                      <div className="bbui-reports-line">
                        <span className="bbui-mono bbui-reports-name">{run.name}</span>
                        <span>
                          {i === 0 ? "Fastest" : `${fmt(run.ratio, { decimals: 2 })} times slower`}
                          {run.failed ? <span className="bbui-label">, a run exited with an error</span> : null}
                        </span>
                      </div>
                      <div className="bbui-reports-pair">
                        <span className="bbui-label">Mean</span>
                        <Bar value={run.mean} max={max} tone={i === 0 ? undefined : "muted"} />
                        <span className="bbui-reports-num">{`${seconds(run.mean)}${run.stddev !== undefined ? ` ± ${seconds(run.stddev)}` : ""}`}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          );
        }
        const better = r.rows.filter((x) => x.verdict === "better").length;
        const worse = r.rows.filter((x) => x.verdict === "worse").length;
        return (
          <>
            <Lede look={worse ? VERDICT_LOOK.worse : better ? VERDICT_LOOK.better : VERDICT_LOOK.same}>
              {countWords([[better, "better"], [worse, "worse"]]) || "No change"}
              <span className="bbui-label">{` of ${plural(r.rows.length, "measurement")}`}</span>
            </Lede>
            <ol className="bbui-reports-list" aria-label="Measurements">
              {r.rows.map((row, i) => (
                <CompareRow key={i} row={row} max={Math.max(row.before, row.after)} unit={props.unit} />
              ))}
            </ol>
          </>
        );
      }}
    </Report>
  ),
});

// ---------- Waterfall ----------

/** 3 to 5 round ticks from 0 to `end`. */
function ticks(end: number): number[] {
  if (!(end > 0)) return [0];
  const raw = end / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => end / s <= 5)!;
  return Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
}

const Waterfall = defineComponent({
  name: "Waterfall",
  description: "Timings as bars on a shared time axis: spans inline (start and duration in `unit`, default ms; depth indents) or a HAR file from the thread.",
  props: z.object({
    source: z.union([z.string(), z.array(z.object({ name: z.string(), start: z.number(), duration: z.number(), depth: z.number().optional() }))]),
    unit: z.string().optional(),
  }),
  component: ({ props }) => (
    <Report
      title="Timeline"
      label="timeline"
      source={props.source}
      parse={(input) => parseWaterfall(input, props.unit ?? "ms")}
      isEmpty={(t) => t.spans.length === 0}
      empty={{ title: "No timings in this report", hint: "Give spans with a name, start and duration, or a HAR file." }}
      skeleton={<Shape label="timeline" rows={6} />}
    >
      {(t) => {
        const origin = Math.min(0, t.begin);
        const range = t.end - origin || 1;
        const marks = ticks(range);
        const span = marks[marks.length - 1]! >= range ? marks[marks.length - 1]! : range;
        const x = (v: number) => ((v - origin) / span) * 100;
        const at = (v: number) => fmt(v, { unit: t.unit });
        const shown = t.spans.slice(0, 60);
        const failed = t.spans.filter((s) => s.failed).length;
        return (
          <figure className="bbui-reports-figure-block">
            <figcaption className="bbui-reports-lede">
              <span>
                {`${plural(t.spans.length, "span")} over ${at(t.end - origin)}`}
                <span className="bbui-label">{failed ? `, ${failed} failed` : ""}</span>
              </span>
            </figcaption>
            <ol className="bbui-reports-list bbui-reports-lanes">
              {shown.map((s, i) => (
                <li key={i} className="bbui-reports-lane">
                  <span className="bbui-reports-lane-name" style={{ paddingInlineStart: `calc(${s.depth} * var(--bbui-s3))` }}>
                    {s.failed ? <StatusIcon icon={CircleX} tone="bad" word="Failed" /> : null}
                    <span className="bbui-reports-path" title={s.name}>
                      {s.name}
                    </span>
                    {s.detail ? <span className="bbui-label bbui-reports-num">{s.detail}</span> : null}
                  </span>
                  <svg className="bbui-reports-track" role="img" aria-label={`Starts at ${at(s.start - origin)}, takes ${at(s.duration)}`}>
                    {marks.map((m) => (
                      <line key={m} className="bbui-reports-grid" x1={`${x(m)}%`} x2={`${x(m)}%`} y1="0" y2="100%" />
                    ))}
                    <rect
                      className="bbui-reports-span"
                      data-tone={s.failed ? "bad" : undefined}
                      x={`${x(s.start)}%`}
                      width={`${Math.max(0.4, (s.duration / span) * 100)}%`}
                      y="6"
                      height="12"
                      rx="2"
                    />
                  </svg>
                  <span className="bbui-reports-num">{at(s.duration)}</span>
                </li>
              ))}
            </ol>
            <div className="bbui-reports-lane bbui-reports-axis" aria-hidden="true">
              <span />
              <span className="bbui-reports-ticks">
                {marks.map((m) => (
                  <span key={m} className="bbui-label" style={{ insetInlineStart: `${x(m)}%` }}>
                    {fmt(m)}
                  </span>
                ))}
              </span>
              <span className="bbui-label">{t.unit}</span>
            </div>
            {t.spans.length > shown.length ? <p className="bbui-label">{`${t.spans.length - shown.length} more not shown`}</p> : null}
          </figure>
        );
      }}
    </Report>
  ),
});

// ---------- Provenance ----------

const STAGE_LOOK: Record<StageStatus, Look> = {
  done: { icon: CircleCheck, tone: "good", word: "Done" },
  running: { icon: LoaderCircle, tone: "accent", word: "Running" },
  pending: { icon: CircleDashed, tone: "neutral", word: "Pending" },
  failed: { icon: CircleX, tone: "bad", word: "Failed" },
  skipped: { icon: CircleMinus, tone: "neutral", word: "Skipped" },
};
const DRIFT: Look = { icon: TriangleAlert, tone: "warn", word: "Differs" };
const factValue = z.union([z.string(), z.number()]);

const Provenance = defineComponent({
  name: "Provenance",
  description:
    "What reached live, stage by stage from source, with facts (branch, sha, build, device...). Flags facts that differ from `expected` or from the stage before.",
  props: z.object({
    stages: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["done", "running", "pending", "failed", "skipped"]),
        facts: z.record(z.string(), factValue).optional(),
        detail: z.string().optional(),
      }),
    ),
    expected: z.record(z.string(), factValue).optional(),
  }),
  component: ({ props }) => {
    const r = parseProvenance(props.stages, props.expected);
    if (r.stages.length === 0) {
      return (
        <section className="bbui bbui-reports" aria-label="Provenance">
          <h3 className="bbui-head bbui-reports-title">Provenance</h3>
          <EmptyState title="No stages yet" hint="List the stages from source to live, each with the facts it reported." />
        </section>
      );
    }
    const first = r.drift[0];
    return (
      <section className="bbui bbui-reports" aria-label="Provenance">
        <h3 className="bbui-head bbui-reports-title">Provenance</h3>
        <Lede look={first ? DRIFT : STAGE_LOOK.done}>
          {first ? `${plural(r.drift.length, "fact differs", "facts differ")}` : "Facts agree from source to live"}
          <span className="bbui-label">{first ? `: ${r.drift.map((d) => `${d.fact.key} at ${d.stage}`).join(", ")}` : ""}</span>
        </Lede>
        <ol className="bbui-reports-list" aria-label="Stages, source to live">
          {r.stages.map((s, i) => (
            <li key={i} className="bbui-reports-row">
              <StatusIcon {...STAGE_LOOK[s.status]} />
              <div className="bbui-reports-main">
                <div className="bbui-reports-line">
                  <span className="bbui-reports-name">{s.name}</span>
                  <span className="bbui-label">{STAGE_LOOK[s.status].word}</span>
                </div>
                {s.detail ? <span className="bbui-label">{s.detail}</span> : null}
                {s.facts.length ? (
                  <dl className="bbui-reports-facts">
                    {s.facts.map((f) => (
                      <div key={f.key} className="bbui-reports-fact" data-drift={f.expected || f.changed ? "" : undefined}>
                        <dt className="bbui-label">{f.key}</dt>
                        <dd className="bbui-mono">{f.value}</dd>
                        {f.expected || f.changed ? (
                          <dd className="bbui-reports-drift">
                            <StatusIcon {...DRIFT} />
                            <span>
                              {[f.expected ? `expected ${f.expected}` : null, f.changed ? `was ${f.changed.value} at ${f.changed.stage}` : null].filter(Boolean).join(", ")}
                            </span>
                          </dd>
                        ) : null}
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  },
});

// ---------- group ----------

export const reportsGroup: ExtraGroup = {
  name: "Reports",
  notes: [
    "For tool output, write it to a file in this thread (e.g. $BB_THREAD_STORAGE/vitest.json) and pass the path; the component detects the format. Small results can go inline as rows.",
  ],
  components: [Tests, Findings, Coverage, Dependencies, Pipeline, Benchmark, Waterfall, Provenance],
  examples: {
    Tests: `root = Stack([t])
t = Tests([{name: "checkout > applies the promo code", status: "failed", message: "Expected total 42.50, received 45.00", file: "src/checkout.test.ts", line: 88}, {name: "checkout > adds an item", status: "passed"}, {name: "checkout > removes an item", status: "passed"}, {name: "checkout > pays with a saved card", status: "skipped", message: "needs the payments sandbox"}], "Checkout tests")`,
    Findings: `root = Stack([f])
f = Findings([{severity: "error", title: "Retry loop never gives up", file: "src/sync/retry.ts", line: 41, detail: "while (true) retries a 4xx forever", fix: "Stop after 5 attempts and surface the error", status: "open"}, {severity: "warning", title: "Token logged at debug level", file: "src/auth/session.ts", line: 17, fix: "Log the token id, not the token"}, {severity: "info", title: "Duplicate date helper", file: "src/sync/retry.ts", line: 3}], "Review of the sync branch")`,
    Coverage: `root = Stack([c])
c = Coverage([{file: "src/billing/invoice.ts", lines: 58.2, branches: 41.0, functions: 66.7}, {file: "src/billing/tax.ts", lines: 91.4, branches: 80.0, functions: 100}, {file: "src/billing/format.ts", lines: 100, branches: 100, functions: 100}])`,
    Dependencies: `root = Stack([d])
d = Dependencies([{name: "react", current: "18.3.1", latest: "19.1.0"}, {name: "zod", current: "3.23.8", latest: "3.25.76"}, {name: "vite", current: "6.2.1", latest: "6.2.4"}])`,
    Pipeline: `root = Stack([p])
p = Pipeline([{name: "Build", status: "passed", duration: 74}, {name: "Test", status: "failed", duration: 212, jobs: [{name: "unit", status: "passed", duration: 96}, {name: "e2e", status: "failed", duration: 116}]}, {name: "Deploy", status: "skipped"}])`,
    Benchmark: `root = Stack([b])
b = Benchmark([{name: "Cold start", before: 840, after: 610}, {name: "Search, 10k rows", before: 132, after: 141}, {name: "Checkout, p95", before: 380, after: 378}], "ms")`,
    Waterfall: `root = Stack([w])
w = Waterfall([{name: "GET /orders", start: 0, duration: 420}, {name: "auth check", start: 6, duration: 38, depth: 1}, {name: "db: select orders", start: 48, duration: 290, depth: 1}, {name: "render json", start: 342, duration: 70, depth: 1}], "ms")`,
    Provenance: `root = Stack([p])
p = Provenance([{name: "Source", status: "done", facts: {branch: "feat/399", sha: "1a68a022fefb"}}, {name: "Build", status: "done", facts: {branch: "feat/399", sha: "1a68a02", build: 2811}}, {name: "Install on test phone", status: "done", facts: {build: 2810, device: "Test iPhone 15"}}], {branch: "feat/399", device: "Test iPhone 15"})`,
  },
};
