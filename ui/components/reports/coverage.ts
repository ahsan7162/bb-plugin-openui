// Coverage from lcov.info, istanbul's coverage-summary.json, or an inline
// list [{file, lines, branches?, functions?, statements?}] of percentages. Pure.
import { isObj, num, shortenPaths, str, tryJson } from "./common";

export const METRICS = ["lines", "branches", "functions", "statements"] as const;
export type MetricName = (typeof METRICS)[number];
/** covered of total; `total` is undefined for inline percentages. A metric the tool did not report is absent. */
export interface Metric {
  pct: number;
  covered?: number;
  total?: number;
}
export type Metrics = Partial<Record<MetricName, Metric>>;
export interface FileCoverage {
  file: string;
  metrics: Metrics;
}
export interface CoverageReport {
  totals: Metrics;
  /** Worst first, by lines (or the first metric the tool reports). */
  files: FileCoverage[];
}

const USAGE = "Coverage reads lcov.info, coverage-summary.json, or [{file, lines, branches?, functions?}] percentages";

const metric = (covered: number, total: number): Metric | undefined => (total > 0 ? { pct: (covered / total) * 100, covered, total } : undefined);

export function parseCoverage(input: string | unknown[]): CoverageReport {
  let files: FileCoverage[];
  let totals: Metrics | undefined;
  if (Array.isArray(input)) files = fromInline(input);
  else {
    const text = input.trim();
    const json = text.startsWith("{") ? tryJson(text) : undefined;
    if (isObj(json)) [files, totals] = fromSummary(json);
    else if (/^(TN|SF):/m.test(text)) files = fromLcov(text);
    else if (text === "") files = [];
    else throw new Error(USAGE);
  }
  const short = shortenPaths(files.map((f) => f.file));
  for (const f of files) f.file = short(f.file);
  const key = (f: FileCoverage) => METRICS.map((m) => f.metrics[m]?.pct).find((p) => p !== undefined) ?? 101;
  files.sort((a, b) => key(a) - key(b) || a.file.localeCompare(b.file));
  return { totals: totals ?? sum(files), files };
}

/** Totals summed from counts; inline percentages average instead. */
function sum(files: FileCoverage[]): Metrics {
  const totals: Metrics = {};
  for (const name of METRICS) {
    const have = files.map((f) => f.metrics[name]).filter((m): m is Metric => m !== undefined);
    if (have.length === 0) continue;
    if (have.every((m) => m.total !== undefined)) {
      totals[name] = metric(
        have.reduce((n, m) => n + m.covered!, 0),
        have.reduce((n, m) => n + m.total!, 0),
      );
    } else totals[name] = { pct: have.reduce((n, m) => n + m.pct, 0) / have.length };
  }
  return totals;
}

function fromInline(rows: unknown[]): FileCoverage[] {
  return rows.filter(isObj).flatMap((row) => {
    const file = str(row.file) ?? str(row.name);
    if (!file) return [];
    const metrics: Metrics = {};
    for (const name of METRICS) {
      const pct = num(row[name]);
      if (pct !== undefined) metrics[name] = { pct: Math.max(0, Math.min(100, pct)) };
    }
    return [{ file, metrics }];
  });
}

function fromSummary(json: Record<string, unknown>): [FileCoverage[], Metrics | undefined] {
  const read = (entry: unknown): Metrics => {
    const metrics: Metrics = {};
    if (!isObj(entry)) return metrics;
    for (const name of METRICS) {
      const m = entry[name];
      if (!isObj(m)) continue;
      const covered = num(m.covered);
      const total = num(m.total);
      const value = covered !== undefined && total !== undefined ? metric(covered, total) : undefined;
      if (value) metrics[name] = value;
    }
    return metrics;
  };
  const files = Object.entries(json)
    .filter(([key]) => key !== "total")
    .map(([file, entry]) => ({ file, metrics: read(entry) }))
    .filter((f) => Object.keys(f.metrics).length > 0);
  if (!isObj(json.total) && files.length === 0) throw new Error(USAGE);
  return [files, isObj(json.total) ? read(json.total) : undefined];
}

function fromLcov(text: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  for (const record of text.split(/^end_of_record\s*$/m)) {
    const file = /^SF:(.+)$/m.exec(record)?.[1]?.trim();
    if (!file) continue;
    const field = (name: string) => {
      const m = new RegExp(`^${name}:(\\d+)`, "m").exec(record);
      return m ? Number(m[1]) : undefined;
    };
    // LF/LH are optional in some writers; count DA lines then.
    const da = [...record.matchAll(/^DA:\d+,(\d+)/gm)];
    const lines = metric(field("LH") ?? da.filter((d) => Number(d[1]) > 0).length, field("LF") ?? da.length);
    const branches = metric(field("BRH") ?? 0, field("BRF") ?? 0);
    const functions = metric(field("FNH") ?? 0, field("FNF") ?? 0);
    const metrics: Metrics = {};
    if (lines) metrics.lines = lines;
    if (branches) metrics.branches = branches;
    if (functions) metrics.functions = functions;
    files.push({ file, metrics });
  }
  return files;
}
