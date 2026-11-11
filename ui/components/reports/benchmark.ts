// Benchmarks: before/after rows [{name, before, after, better?}] or
// hyperfine --export-json runs ranked against the fastest. Pure.
import { isObj, list, num, str, tryJson } from "./common";

export type Better = "lower" | "higher";
export type Verdict = "better" | "worse" | "same" | "new";
export interface Comparison {
  name: string;
  before: number;
  after: number;
  better: Better;
  /** (after - before) / before; undefined when before is 0. */
  change?: number;
  verdict: Verdict;
}
export interface RankedRun {
  name: string;
  mean: number;
  stddev?: number;
  /** mean / fastest mean; 1 for the fastest. */
  ratio: number;
  failed: boolean;
}
export type BenchmarkReport = { kind: "compare"; rows: Comparison[] } | { kind: "ranked"; unit: "s"; runs: RankedRun[] };

const USAGE = "Benchmark reads [{name, before, after, better?}] or hyperfine --export-json output";
/** Changes under 1% read as no change: run-to-run noise in most benchmarks. */
const SAME = 0.01;

export function compare(name: string, before: number, after: number, better: Better): Comparison {
  if (before === 0) return { name, before, after, better, verdict: after === 0 ? "same" : "new" };
  const change = (after - before) / Math.abs(before);
  const improved = better === "lower" ? change < 0 : change > 0;
  return { name, before, after, better, change, verdict: Math.abs(change) < SAME ? "same" : improved ? "better" : "worse" };
}

const TIME_UNITS = /^(ns|µs|us|ms|s|sec|secs|seconds|min|minutes|m|h)$/i;
export const isTimeUnit = (unit: string | undefined) => unit === undefined || TIME_UNITS.test(unit.trim());

/** "12% faster", "8% slower", "3% higher": the change in words. Lower time is faster. */
export function changeWords(row: Comparison, unit?: string): string {
  if (row.verdict === "new") return "new, was zero";
  if (row.change === undefined || row.verdict === "same") return "no change";
  const pct = Math.abs(row.change) * 100;
  const amount = pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
  const up = row.change > 0;
  const word = row.better === "lower" && isTimeUnit(unit) ? (up ? "slower" : "faster") : up ? "higher" : "lower";
  return `${amount}% ${word}`;
}

export function parseBenchmark(input: string | unknown[]): BenchmarkReport {
  const json = Array.isArray(input) ? input : tryJson(input.trim());
  if (Array.isArray(json)) return { kind: "compare", rows: fromRows(json) };
  if (isObj(json) && Array.isArray(json.results)) return { kind: "ranked", unit: "s", runs: fromHyperfine(json.results) };
  throw new Error(USAGE);
}

function fromRows(rows: unknown[]): Comparison[] {
  return rows.filter(isObj).flatMap((row) => {
    const name = str(row.name);
    const before = num(row.before);
    const after = num(row.after);
    if (!name || before === undefined || after === undefined) return [];
    return [compare(name, before, after, row.better === "higher" ? "higher" : "lower")];
  });
}

function fromHyperfine(results: unknown[]): RankedRun[] {
  const runs = results.filter(isObj).flatMap((r) => {
    const mean = num(r.mean);
    const name = str(r.command);
    if (mean === undefined || !name) return [];
    return [{ name, mean, stddev: num(r.stddev), failed: list(r.exit_codes).some((c) => c !== 0) }];
  });
  const fastest = Math.min(...runs.map((r) => r.mean));
  return runs.map((r) => ({ ...r, ratio: fastest > 0 ? r.mean / fastest : 1 })).sort((a, b) => a.mean - b.mean);
}
