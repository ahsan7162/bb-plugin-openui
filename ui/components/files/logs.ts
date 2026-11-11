// What Logs shows: build or server output read into lines, each cut into
// styled runs (ANSI colours mapped to kit tones, JSON records made readable)
// and classified as an error, a warning or neither. Pure: no React, no DOM.

export type RunTone = "bad" | "warn" | "good" | "accent" | "muted";
export interface Run {
  text: string;
  tone?: RunTone;
  bold?: boolean;
}
export type Level = "error" | "warn";
export interface LogLine {
  /** 1-based line number in the source. */
  n: number;
  text: string;
  runs: Run[];
  level: Level | null;
}
export interface Log {
  lines: LogLine[];
  /** Indexes into `lines`. */
  errors: number[];
  warnings: number[];
}

// CSI (colours, cursor moves), OSC (titles, hyperlinks) and the short two-byte escapes.
const ESCAPE = /\x1b\[([0-9;:?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMNOc]/g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE, "");
}

const COLOR_TONES: Record<number, RunTone> = { 30: "muted", 31: "bad", 32: "good", 33: "warn", 34: "accent", 35: "accent", 36: "accent", 90: "muted", 91: "bad", 92: "good", 93: "warn", 94: "accent", 95: "accent", 96: "accent" };

/** One line of terminal text cut into runs by its SGR colours; other escapes dropped. */
export function ansiRuns(text: string): Run[] {
  const runs: Run[] = [];
  let tone: RunTone | undefined;
  let dim = false;
  let bold = false;
  let last = 0;
  const push = (chunk: string) => {
    if (chunk === "") return;
    const run: Run = { text: chunk };
    const shown = tone ?? (dim ? "muted" : undefined);
    if (shown) run.tone = shown;
    if (bold) run.bold = true;
    const prev = runs[runs.length - 1];
    if (prev && prev.tone === run.tone && prev.bold === run.bold) prev.text += chunk;
    else runs.push(run);
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[2] !== "m") continue;
    const codes = (match[1] ?? "").split(/[;:]/).map((c) => (c === "" ? 0 : Number(c)));
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      if (code === 0) [tone, dim, bold] = [undefined, false, false];
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) [dim, bold] = [false, false];
      else if (code === 39) tone = undefined;
      else if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : 4; // 256-colour and RGB arguments
      else if (COLOR_TONES[code]) tone = COLOR_TONES[code];
      else if (code === 37 || code === 97) tone = undefined;
    }
  }
  push(text.slice(last));
  return runs;
}

const ERROR_WORD = /\berr!|\b(?:error|errors|fatal|panic|panicked|exception|traceback|failed|failure|fail)\b|^\s*(?:✖|✗|×|❌)/i;
const WARN_WORD = /\b(?:warn|warning|warnings|deprecated|deprecation)\b|^\s*⚠/i;
const NONE_COUNT = /\b(?:0|no|zero) (?:errors?|warnings?|failures?|failed)\b|\b(?:errors?|warnings?|failures?|failed):? 0\b/i;
// Tallies ("Found 1 error in a.ts", "✖ 3 problems (2 errors, 1 warning)") repeat findings already counted.
const SUMMARY = /^\s*(?:found \d+ (?:errors?|warnings?|problems?)\b|[✖×]\s*\d+ problems?\b)/i;
// Stack frames and similar continuation lines belong to the line above; they are not new findings.
const CONTINUATION = /^\s+(?:at |from |File "|\.\.\. \d+ more)|^\s*\^+\s*$/;

/** The level a plain line of text states, by its first error or warning word; null for neither. */
export function textLevel(text: string): Level | null {
  if (CONTINUATION.test(text) || NONE_COUNT.test(text) || SUMMARY.test(text)) return null;
  const error = ERROR_WORD.exec(text)?.index ?? -1;
  const warn = WARN_WORD.exec(text)?.index ?? -1;
  if (error < 0 && warn < 0) return null;
  if (warn < 0) return "error";
  if (error < 0) return "warn";
  return error < warn ? "error" : "warn";
}

/** A record's level field (a name, or pino/bunyan's 10-60) as a Level. */
function recordLevel(value: unknown): Level | null | undefined {
  if (typeof value === "number") return value >= 50 ? "error" : value >= 40 ? "warn" : null;
  if (typeof value !== "string") return undefined;
  const name = value.toLowerCase();
  if (/^(?:fatal|crit|critical|error|err|emerg|alert|panic|severe)$/.test(name)) return "error";
  if (/^(?:warn|warning)$/.test(name)) return "warn";
  return null;
}

const LEVEL_KEYS = ["level", "lvl", "severity", "levelname", "log.level"];
const MESSAGE_KEYS = ["msg", "message", "event", "text"];
const TIME_KEYS = ["time", "timestamp", "ts", "@timestamp", "t", "asctime"];
const QUIET_KEYS = new Set(["pid", "hostname", "v", "name", "logger"]);

function clock(value: unknown): string | null {
  const ms = typeof value === "number" ? (value < 1e11 ? value * 1000 : value) : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return typeof value === "string" ? value : null;
  return new Date(ms).toISOString().slice(11, 19);
}

function scalar(value: unknown): string {
  return typeof value === "string" ? (/\s/.test(value) ? JSON.stringify(value) : value) : JSON.stringify(value);
}

/** A JSON log record (pino, bunyan, winston, structlog, zap) as one readable line; null when `text` is no record. */
export function recordLine(text: string): { runs: Run[]; level: Level | null } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const fields = { ...(record as Record<string, unknown>) };
  const take = (keys: string[]) => {
    const key = keys.find((k) => k in fields);
    if (key === undefined) return undefined;
    const value = fields[key];
    delete fields[key];
    return value;
  };
  const time = clock(take(TIME_KEYS));
  const levelValue = take(LEVEL_KEYS);
  const message = take(MESSAGE_KEYS);
  const err = take(["err", "error", "exception"]);
  const runs: Run[] = [];
  let level = recordLevel(levelValue) ?? null;
  if (time) runs.push({ text: `${time} `, tone: "muted" });
  if (levelValue !== undefined) {
    const name = typeof levelValue === "string" ? levelValue.toLowerCase() : level ?? "info";
    runs.push({ text: `${name} `, ...(level === "error" ? { tone: "bad" as const } : level === "warn" ? { tone: "warn" as const } : { tone: "muted" as const }) });
  }
  if (message !== undefined) runs.push({ text: typeof message === "string" ? message : JSON.stringify(message) });
  if (err !== undefined) {
    const detail = typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : scalar(err);
    runs.push({ text: `${runs.length > 0 ? " " : ""}${detail}`, tone: "bad" });
    level ??= "error";
  }
  const rest = Object.entries(fields)
    .filter(([key]) => !QUIET_KEYS.has(key))
    .map(([key, value]) => `${key}=${scalar(value)}`)
    .join(" ");
  if (rest) runs.push({ text: `${runs.length > 0 ? "  " : ""}${rest}`, tone: "muted" });
  if (levelValue === undefined && message !== undefined && level === null) level = textLevel(String(message));
  return { runs, level };
}

/** Build or server output as lines: `\r` redraws collapsed to the last draw, colours and records read, levels set. */
export function parseLog(text: string): Log {
  const raw = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lines: LogLine[] = [];
  const errors: number[] = [];
  const warnings: number[] = [];
  if (raw === "") return { lines, errors, warnings };
  raw.split("\n").forEach((source, i) => {
    const drawn = source.slice(source.replace(/\r+$/, "").lastIndexOf("\r") + 1).replace(/\r+$/, "");
    const plain = stripAnsi(drawn);
    const record = recordLine(plain);
    const runs = record?.runs ?? ansiRuns(drawn);
    const level = record ? record.level : textLevel(plain);
    if (level === "error") errors.push(lines.length);
    if (level === "warn") warnings.push(lines.length);
    lines.push({ n: i + 1, text: runs.map((r) => r.text).join(""), runs, level });
  });
  return { lines, errors, warnings };
}

/** What an exit code means, in words. */
export function exitWords(exit: number): string {
  return exit === 0 ? "Succeeded, exit code 0" : `Failed, exit code ${exit}`;
}
