// Paths as Workspace files components name them: deciding whether a prop is a
// path or inline text, which BB file target opens it, and its code language.
// Pure: no React, no DOM.

export const THREAD_STORAGE = "$BB_THREAD_STORAGE/";

/** The environment of the reply's thread, as far as it is known. */
export interface ThreadEnv {
  environmentId: string | null;
  path: string | null;
  hostId: string | null;
}

/** A target `experimental_FileLink` and `experimental_openFilePreview` accept. */
export type FileTarget =
  | { kind: "workspace"; environmentId: string; path: string }
  | { kind: "host"; hostId: string; path: string }
  | { kind: "thread-storage"; threadId: string; path: string };

const FILE_LIKE = /^[\w@~+-][\w@~+.,-]*(?:\/[\w@~+.,-]+)*\.[A-Za-z0-9]{1,8}$/;

/** True when `value` names a file rather than holding the text itself: one line, a storage, absolute or relative path. */
export function isPath(value: string): boolean {
  const text = value.trim();
  if (text === "" || /[\r\n]/.test(text)) return false;
  if (text.startsWith(THREAD_STORAGE)) return true;
  if (/^(?:\/|\.{1,2}\/)[^\s:]/.test(text)) return true;
  return FILE_LIKE.test(text);
}

/** The BB file target for `path` in this thread, or null until the thread's environment is known. */
export function fileTarget(path: string, threadId: string | null, env: ThreadEnv | null): FileTarget | null {
  const clean = path.trim();
  if (clean === "") return null;
  if (clean.startsWith(THREAD_STORAGE)) {
    const rest = clean.slice(THREAD_STORAGE.length).replace(/^\/+/, "");
    return threadId && rest ? { kind: "thread-storage", threadId, path: rest } : null;
  }
  if (!clean.startsWith("/")) {
    const rest = clean.replace(/^(?:\.\/)+/, "");
    return env?.environmentId && !rest.startsWith("../") ? { kind: "workspace", environmentId: env.environmentId, path: rest } : null;
  }
  const root = env?.path?.replace(/\/+$/, "");
  if (root && env?.environmentId && clean.startsWith(`${root}/`)) {
    return { kind: "workspace", environmentId: env.environmentId, path: clean.slice(root.length + 1) };
  }
  return env?.hostId ? { kind: "host", hostId: env.hostId, path: clean } : null;
}

/**
 * The openable path a stack frame or log names: a dev-server URL's path, a
 * file path; null for bare names (a JVM frame's `Invoice.kt`), `<anonymous>`
 * and runtime internals, which no workspace file holds.
 */
export function framePath(file: string | null): string | null {
  if (file === null) return null;
  const path = file.replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "");
  if (/^(?:node:|internal\/|<|\[)|^[a-z][\w+.-]*:\/\//.test(path) || !path.includes("/")) return null;
  return path;
}

/** The last segment of a path, and the directory before it (with its trailing slash). */
export function splitPath(path: string): { dir: string; base: string } {
  const clean = path.replace(/^\$BB_THREAD_STORAGE\//, "");
  const cut = clean.lastIndexOf("/");
  return cut < 0 ? { dir: "", base: clean } : { dir: clean.slice(0, cut + 1), base: clean.slice(cut + 1) };
}

const LANGUAGES: Record<string, string> = {
  ts: "ts", tsx: "tsx", mts: "ts", cts: "ts", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
  sh: "bash", bash: "bash", zsh: "bash", fish: "fish", ps1: "powershell",
  json: "json", jsonc: "jsonc", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", xml: "xml",
  html: "html", css: "css", scss: "scss", less: "less", vue: "vue", svelte: "svelte",
  md: "markdown", mdx: "mdx", sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto",
  lua: "lua", dart: "dart", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure",
  tf: "hcl", hcl: "hcl", dockerfile: "dockerfile", makefile: "makefile", diff: "diff", patch: "diff",
};

/** The code fence language for a file, from its extension or well-known name; "" for plain text. */
export function languageOf(path: string): string {
  const base = splitPath(path).base.toLowerCase();
  if (base === "dockerfile" || base === "makefile") return base;
  const ext = /\.([^.]+)$/.exec(base)?.[1] ?? "";
  return LANGUAGES[ext] ?? "";
}

/** Lines `from` to `to` (1-based, inclusive, clamped) of `text`, and the number of the first. */
export function sliceLines(text: string, from?: number | null, to?: number | null): { start: number; lines: string[]; total: number } {
  const all = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const total = all.length;
  const first = Math.min(Math.max(1, Math.floor(Number.isFinite(from) ? (from as number) : 1)), total);
  const last = Math.min(Math.max(first, Math.floor(Number.isFinite(to) ? (to as number) : total)), total);
  return { start: first, lines: all.slice(first - 1, last), total };
}

/** A fence that `content` cannot close: one backtick longer than its longest run. */
export function fence(content: string, language: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${language}\n${content}\n${ticks}`;
}
