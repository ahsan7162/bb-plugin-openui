// Small pure helpers the report parsers share. No React, no DOM.

export type Obj = Record<string, unknown>;

export const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
export const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

/** A finite number, or a string holding only one ("12.5"). */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(value)) return Number(value);
  return undefined;
}

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// eslint-disable-next-line no-control-regex
export const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

/** Parses JSON or returns undefined, so callers can try the text formats next. */
export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Epoch ms of an ISO time; undefined for missing or GitHub's zero time (0001-01-01). */
export function epoch(value: unknown): number | undefined {
  const text = str(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && ms > Date.UTC(1971, 0, 1) ? ms : undefined;
}

/** "820 ms", "4.2 s", "3m 12s", "1h 4m". */
export function duration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Drops the directory every path shares, so "/home/me/app/src/a.ts" shows as "src/a.ts". */
export function shortenPaths(paths: string[]): (path: string) => string {
  const clean = (p: string) => p.replace(/^file:\/\//, "");
  const unique = [...new Set(paths.map(clean))];
  if (unique.length < 2 || !unique.every((p) => p.includes("/"))) return clean;
  let shared = unique[0]!.split("/").slice(0, -1);
  for (const path of unique) {
    const dir = path.split("/").slice(0, -1);
    let i = 0;
    while (i < shared.length && i < dir.length && shared[i] === dir[i]) i++;
    shared = shared.slice(0, i);
  }
  const prefix = shared.join("/");
  return (p) => {
    const c = clean(p);
    return prefix && c.startsWith(`${prefix}/`) ? c.slice(prefix.length + 1) : c;
  };
}

/** "3 failed, 1 skipped": counts in words, zeros left out. */
export function countWords(parts: [number, string][]): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(", ");
}
