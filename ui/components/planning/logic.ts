// Pure logic for the planning group: date math, three-point estimates and
// weighted scores. No React here so planning.test.ts can import it directly.

const DAY = 86_400_000;

/** Day number (days since 1970-01-01, UTC) of a yyyy-mm-dd string; null if it isn't one. */
export function dayOf(text: unknown): number | null {
  const m = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  return Number.isFinite(ms) ? Math.round(ms / DAY) : null;
}

/** Today as a day number in the viewer's local calendar. */
export function today(now = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
}

export const dateOfDay = (day: number) => new Date(day * DAY);
const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const monFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
/** "Oct 5" */
export const shortDate = (day: number) => shortFmt.format(dateOfDay(day));
/** "Oct" */
export const monthShort = (day: number) => monFmt.format(dateOfDay(day));

/** A month as {year, month (0-11)}. */
export type Month = { year: number; month: number };

/** Month from "yyyy-mm" (or a full date); null if neither. */
export function monthOf(text: unknown): Month | null {
  const m = typeof text === "string" ? /^(\d{4})-(\d{2})/.exec(text) : null;
  if (!m || +m[2]! < 1 || +m[2]! > 12) return null;
  return { year: +m[1]!, month: +m[2]! - 1 };
}

export const shiftMonth = ({ year, month }: Month, by: number): Month => {
  const total = year * 12 + month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
};

export const monthTitle = ({ year, month }: Month) => monthFmt.format(new Date(Date.UTC(year, month, 1)));
export const monthKey = ({ year, month }: Month) => `${year}-${String(month + 1).padStart(2, "0")}`;

/** Weeks (Monday first) of day numbers covering the month; days outside it are null. */
export function monthGrid({ year, month }: Month): (number | null)[][] {
  const first = Math.round(Date.UTC(year, month, 1) / DAY);
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (dateOfDay(first).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => first + i)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** PERT mean and standard deviation of one three-point estimate; likely defaults to the midpoint. */
export function pert(low: number, high: number, likely?: number) {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const m = likely === undefined || !Number.isFinite(likely) ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, likely));
  return { mean: (lo + 4 * m + hi) / 6, sd: (hi - lo) / 6 };
}

/** z for the 90th percentile of a normal distribution. */
export const Z90 = 1.2815515655446004;

/** Total P50 and P90: sum of means, sqrt of summed variances, normal approximation. */
export function totals(tasks: { low: number; high: number; likely?: number }[]) {
  let mean = 0;
  let variance = 0;
  for (const t of tasks) {
    const p = pert(t.low, t.high, t.likely);
    mean += p.mean;
    variance += p.sd * p.sd;
  }
  const sd = Math.sqrt(variance);
  return { p50: mean, p90: mean + Z90 * sd, sd };
}

/** Weighted score of 1-5 scores as a share of the best possible (0-1). Missing scores count 0; zero weights give 0. */
export function weightedScore(scores: readonly number[], weights: readonly number[]): number {
  let got = 0;
  let max = 0;
  weights.forEach((w, i) => {
    const s = Number(scores[i]);
    got += w * (Number.isFinite(s) ? Math.min(5, Math.max(0, s)) : 0);
    max += w * 5;
  });
  return max > 0 ? got / max : 0;
}

/** Indexes of options sorted best first (stable on ties). */
export function rank(options: readonly { scores: readonly number[] }[], weights: readonly number[]): number[] {
  const score = options.map((o) => weightedScore(o.scores, weights));
  return options.map((_, i) => i).sort((a, b) => score[b]! - score[a]! || a - b);
}

/** Distinct values in first-seen order. */
export const ordered = (values: readonly string[]) => [...new Set(values)];

/** "in_progress" -> "In progress" */
export const humanize = (text: string) => {
  const t = text.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
