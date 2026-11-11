// Pure logic behind the Inputs and learning group: no React, so inputs.test.ts can run it in Node.

const decimalsOf = (n: number) => (Number.isFinite(n) ? (String(n).split(".")[1] ?? "").length : 0);

/** value + delta, rounded to the step's decimals (0.1 + 0.2 = 0.3) and kept within [min, max]. */
export function stepTo(value: number, delta: number, step: number, min = -Infinity, max = Infinity): number {
  const places = Math.max(decimalsOf(step), decimalsOf(delta));
  const factor = 10 ** places;
  const next = Math.round((value + delta) * factor) / factor;
  return Math.min(max, Math.max(min, next));
}

/** A copy of list with item i moved by dir (-1 up, +1 down); unchanged at the edges. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export const removeAt = <T>(list: readonly T[], i: number): T[] => list.filter((_, k) => k !== i);
export const replaceAt = <T>(list: readonly T[], i: number, item: T): T[] => list.map((v, k) => (k === i ? item : v));

/** 83_000 ms -> "1:23", 3_723_000 -> "1:02:03". Countdowns pass `up = true` so 0.2 s left still shows 0:01. */
export function clock(ms: number, up = false): string {
  const total = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Number of picks equal to the answer index. */
export const quizScore = (picks: readonly (number | null)[], answers: readonly (number | undefined)[]): number =>
  picks.reduce<number>((sum, pick, i) => sum + (pick !== null && pick === answers[i] ? 1 : 0), 0);

/** A fenced code block whose fence outgrows any backtick run in the code; language limited to safe characters. */
export function codeFence(code: string, language?: string): string {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const lang = (language ?? "").replace(/[^\w+-]/g, "");
  return `${fence}${lang}\n${code}\n${fence}`;
}
