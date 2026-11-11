// What StackTrace shows: an error as a runtime printed it, read into the error
// that surfaced and the errors behind it, each with its frames innermost first
// and every frame marked app or library. JavaScript/TypeScript (V8, Firefox,
// Safari), Python, Java/Kotlin, Go, Rust and Ruby. Pure: no React, no DOM.

export type TraceLanguage = "javascript" | "python" | "java" | "go" | "rust" | "ruby";
export interface Frame {
  fn: string;
  /** The file as printed; null when the frame names none. */
  file: string | null;
  line: number | null;
  col: number | null;
  /** Runtime, standard library or dependency code rather than the app's own. */
  library: boolean;
}
/** How a section relates to the one before it: what caused it, or what it happened while handling. */
export type Relation = "cause" | "context" | "suppressed";
export interface Section {
  relation: Relation | null;
  type: string;
  message: string;
  frames: Frame[];
}
export interface Trace {
  language: TraceLanguage;
  /** The error that surfaced first, then the errors behind it. */
  sections: Section[];
}

export const LANGUAGE_NAMES: Record<TraceLanguage, string> = {
  javascript: "JavaScript", python: "Python", java: "Java", go: "Go", rust: "Rust", ruby: "Ruby",
};

const LIBRARY_PATH =
  /node_modules|^node:|^internal\/|\(internal\/|site-packages|dist-packages|<frozen |\/lib\/python\d|\/usr\/lib\/|\/usr\/local\/lib\/|\/gems\/|\/rubygems\/|\/lib\/ruby\/|^\/rustc\/|\.cargo\/registry|\.rustup\/|\/usr\/local\/go\/|\/go\/pkg\/mod\/|\/pkg\/mod\/|\/libexec\/src\//;
const LIBRARY_JVM = /^(?:java|javax|jdk|sun|com\.sun|kotlin|kotlinx|scala|org\.junit|org\.springframework|org\.apache|org\.gradle|io\.netty|reactor|com\.google|okhttp3|androidx|android)\./;
const LIBRARY_FN = /^(?:std::|core::|alloc::|rust_begin_unwind|__rust|runtime\.|testing\.|reflect\.)|^<std>::|^Module\._compile|^process\.processTicksAndRejections/;

function frame(fn: string, file: string | null, line?: string | number | null, col?: string | number | null): Frame {
  const cleanFile = file === null ? null : file.replace(/^file:\/\//, "").replace(/^webpack:\/\/\/?/, "");
  const library = (cleanFile !== null && LIBRARY_PATH.test(cleanFile)) || LIBRARY_FN.test(fn) || LIBRARY_JVM.test(fn);
  const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
  return { fn, file: cleanFile, line: num(line), col: num(col), library };
}

/** `Type: message` split; text that names no type is all message. */
export function splitHeader(text: string): { type: string; message: string } {
  const match = /^((?:[A-Za-z_$][\w$]*[.:]{0,2})*[A-Za-z_$][\w$]*(?:\[[^\]]*\])?)(?::\s*([\s\S]*))?$/.exec(text.trim());
  if (match && (match[2] !== undefined || /(?:Error|Exception|Panic|Interrupt|Exit|Warning)$/.test(match[1]!))) {
    return { type: match[1]!, message: (match[2] ?? "").trim() };
  }
  return { type: "", message: text.trim() };
}

export function detectLanguage(text: string): TraceLanguage {
  if (/Traceback \(most recent call last\):|^\s*File ".+", line \d+/m.test(text)) return "python";
  if (/thread '.*' panicked at/.test(text)) return "rust";
  if (/^goroutine \d+ \[/m.test(text) || (/^panic: /m.test(text) && /\.go:\d+/.test(text))) return "go";
  if (/^\s*at [\w$.<>/-]+\((?:[^()\s]+\.(?:java|kt|kts|scala|groovy):\d+|Native Method|Unknown Source)\)/m.test(text)) return "java";
  if (/^\s*(?:from )?[^\s:]+\.rb:\d+:in [`']/m.test(text)) return "ruby";
  return "javascript";
}

/** Reads a printed stack trace (or a serialized `{name, message, stack}`); throws for text that holds no error. */
export function parseTrace(input: string): Trace {
  const text = fromJson(input).replace(/\r\n?/g, "\n").replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (text === "") throw new Error("the trace is empty");
  const language = detectLanguage(text);
  const sections = PARSERS[language](text.split("\n"));
  if (sections.length === 0) throw new Error("no error was found in this text");
  return { language, sections };
}

function fromJson(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return input;
  try {
    const value = JSON.parse(trimmed) as { name?: unknown; message?: unknown; stack?: unknown };
    const header = [value.name, value.message].filter((v) => typeof v === "string" && v !== "").join(": ");
    const stack = typeof value.stack === "string" ? value.stack : "";
    return stack.trimStart().startsWith(header) ? stack : `${header}\n${stack}`;
  } catch {
    return input;
  }
}

const PARSERS: Record<TraceLanguage, (lines: string[]) => Section[]> = {
  javascript: parseJs,
  python: parsePython,
  java: parseJava,
  go: parseGo,
  rust: parseRust,
  ruby: parseRuby,
};

/** `file:line:col` (or `file:line`) at the end of a location string. */
function location(text: string): { file: string; line: string; col: string | null } | null {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(text.trim());
  return match ? { file: match[1]!, line: match[2]!, col: match[3] ?? null } : null;
}

function newSection(relation: Relation | null, header: string): Section {
  return { relation, ...splitHeader(header), frames: [] };
}

// JavaScript: V8 "at fn (file:1:2)", Firefox/Safari "fn@file:1:2", causes as "Caused by:" or "[cause]:".
function parseJs(lines: string[]): Section[] {
  const sections: Section[] = [];
  let header: string[] = [];
  let current = null as Section | null; // assigned inside open(), which narrowing does not follow
  let relation: Relation | null = null;
  const open = () => {
    // Node prints the failing source line and a caret above the error; keep from the line naming the error.
    let start = 0;
    header.forEach((l, i) => /^(?:Uncaught )?[\w$.]*(?:Error|Exception)\b/.test(l.trim()) && (start = i));
    current = newSection(relation, header.slice(start).join("\n").replace(/^Uncaught /, ""));
    sections.push(current);
    header = [];
    relation = "cause";
  };
  for (const line of lines) {
    const v8 = /^\s*at (?:async )?(?:(.+?) \((.+)\)|(.+?))(?: \{)?$/.exec(line);
    const gecko = v8 ? null : /^\s*([^\s@]*)@(.+:\d+(?::\d+)?)$/.exec(line);
    if (v8 || gecko) {
      if (current === null) open();
      const fn = v8 ? (v8[1] ?? "") : gecko![1]!;
      const where = (v8 ? (v8[2] ?? v8[3]!) : gecko![2]!).replace(/^eval at .*, /, "");
      const loc = location(where);
      current!.frames.push(loc ? frame(fn, loc.file, loc.line, loc.col) : frame(fn || where, null));
      continue;
    }
    const cause = /^\s*(?:\[cause\]:|Caused by:)\s*(.*)$/.exec(line);
    if (cause) {
      if (current === null && header.length > 0) open();
      current = null;
      header = cause[1] ? [cause[1]] : [];
      continue;
    }
    if (line.trim() === "" || /^\s*\.\.\. \d+ (?:more|lines)|^\s*[{}\]]|^Node\.js v\d/.test(line)) continue;
    // A line after frames that is no frame starts the next error (Firefox prints no "Caused by").
    if (current !== null && current.frames.length > 0) current = null;
    header.push(line.trimEnd());
  }
  if (current === null && header.length > 0) open();
  return sections;
}

// Python: chained tracebacks, oldest first, frames outermost first.
function parsePython(lines: string[]): Section[] {
  const chunks: { relation: Relation | null; lines: string[] }[] = [{ relation: null, lines: [] }];
  for (const line of lines) {
    if (/^The above exception was the direct cause/.test(line)) chunks.push({ relation: "cause", lines: [] });
    else if (/^During handling of the above exception/.test(line)) chunks.push({ relation: "context", lines: [] });
    else chunks[chunks.length - 1]!.lines.push(line);
  }
  const sections = chunks.map(({ lines: chunk }) => {
    const frames: Frame[] = [];
    let header: string[] = [];
    for (const line of chunk) {
      const match = /^\s*File "(.+)", line (\d+)(?:, in (.+))?$/.exec(line);
      if (match) {
        frames.push(frame(match[3] ?? "<module>", match[1]!, match[2]));
        header = [];
      } else if (/^\S/.test(line) && !/^Traceback /.test(line)) {
        header.push(line);
      } else if (header.length > 0 && line.trim() !== "") {
        header.push(line.trim());
      }
    }
    return { ...splitHeader(header.join("\n")), frames: frames.reverse() };
  });
  // Printed oldest first; shown surfaced first, each earlier one as what the later one came from.
  const shown: Section[] = [];
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    if (s.type === "" && s.message === "" && s.frames.length === 0) continue;
    shown.push({ relation: i === sections.length - 1 ? null : chunks[i + 1]!.relation, ...s });
  }
  return shown;
}

// Java, Kotlin, Scala: "at pkg.Cls.fn(File.java:12)", "Caused by:", "Suppressed:".
function parseJava(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const at = /^\s*at ([\w$.<>/-]+)\(([^)]*)\)/.exec(line);
    if (at) {
      if (current === null) sections.push((current = newSection(null, "")));
      const fn = at[1]!.replace(/^[\w.-]+\/\/?/, ""); // module prefix "java.base/"
      const loc = /^(.+?):(\d+)$/.exec(at[2]!);
      current.frames.push(loc ? frame(fn, loc[1]!, loc[2]) : { ...frame(fn, null), library: true });
      continue;
    }
    const linked = /^\s*(Caused by|Suppressed):\s*(.*)$/.exec(line);
    if (linked) {
      sections.push((current = newSection(linked[1] === "Suppressed" ? "suppressed" : "cause", linked[2]!)));
      continue;
    }
    if (/^\s*\.\.\. \d+ (?:more|common frames omitted)/.test(line) || line.trim() === "") continue;
    if (current === null || current.frames.length > 0) {
      const header = line.replace(/^Exception in thread "[^"]*"\s*/, "").trim();
      sections.push((current = newSection(null, header)));
    } else {
      current.message = [current.message, line.trim()].filter(Boolean).join("\n");
    }
  }
  return sections;
}

// Go: "panic: msg", then the panicking goroutine's frames as "fn(args)" over "\tfile.go:12 +0x1d".
function parseGo(lines: string[]): Section[] {
  const start = lines.findIndex((l) => /^(?:panic|fatal error): /.test(l));
  const head = start >= 0 ? lines[start]! : lines.find((l) => l.trim() !== "") ?? "";
  const kind = /^(panic|fatal error): (.*)$/.exec(head);
  const section: Section = { relation: null, type: kind ? kind[1]! : "", message: kind ? kind[2]!.replace(/ \[recovered\]$/, "") : head.trim(), frames: [] };
  let goroutines = 0;
  for (let i = Math.max(0, start) + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^goroutine \d+ \[/.test(line)) {
      if (++goroutines > 1) break;
      continue;
    }
    if (goroutines === 0 && section.frames.length === 0 && line.trim() !== "" && !/^\s/.test(line)) {
      section.message += `\n${line.trim()}`;
      continue;
    }
    const where = /^\s+(.+\.go):(\d+)(?: \+0x[0-9a-f]+)?$/.exec(lines[i + 1] ?? "");
    if (where && /^\S/.test(line)) {
      const fn = line.replace(/\(.*\)$/, "").replace(/^created by /, "");
      section.frames.push(frame(fn, where[1]!, where[2]));
      i++;
    }
  }
  section.message = section.message.trim();
  return [section];
}

// Rust: "thread 'main' panicked at src/main.rs:5:9:\nmsg" (or the older "at 'msg', file:l:c"), then the backtrace.
function parseRust(lines: string[]): Section[] {
  const text = lines.join("\n");
  const modern = /thread '([^']*)' panicked at ([^\n]+?):(\d+):(\d+):\n([\s\S]*?)(?=\nnote: |\nstack backtrace:|$)/.exec(text);
  const legacy = /thread '([^']*)' panicked at '([\s\S]*?)', ([^\n]+?):(\d+):(\d+)/.exec(text);
  const section: Section = { relation: null, type: "panic", message: "", frames: [] };
  if (modern) {
    section.message = modern[5]!.trim();
    section.frames.push(frame(`thread '${modern[1]}'`, modern[2]!, modern[3], modern[4]));
  } else if (legacy) {
    section.message = legacy[2]!;
    section.frames.push(frame(`thread '${legacy[1]}'`, legacy[3]!, legacy[4], legacy[5]));
  } else {
    section.message = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  }
  const backtrace = lines.findIndex((l) => /^stack backtrace:/.test(l));
  if (backtrace >= 0) {
    const frames: Frame[] = [];
    for (let i = backtrace + 1; i < lines.length; i++) {
      const fn = /^\s*\d+:\s+(?:0x[0-9a-f]+ - )?(.+)$/.exec(lines[i]!);
      if (!fn) continue;
      const at = /^\s+at (.+?):(\d+)(?::(\d+))?$/.exec(lines[i + 1] ?? "");
      if (at) i++;
      frames.push(at ? frame(fn[1]!, at[1]!, at[2], at[3]) : frame(fn[1]!, null));
    }
    // The panic machinery sits innermost; the panic location already leads the list.
    section.frames.push(...frames.filter((f) => !/^(?:rust_begin_unwind|core::panicking::|std::panicking::|std::rt::|std::sys|__rust)/.test(f.fn)));
  }
  return [section];
}

// Ruby: "file.rb:12:in `fn': message (Type)" then "\tfrom file.rb:5:in `fn'".
function parseRuby(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const from = /^\s*from (.+?):(\d+):in [`'](.+?)'$/.exec(line);
    if (from && current) {
      current.frames.push(frame(from[3]!, from[1]!, from[2]));
      continue;
    }
    const top = /^(.+?):(\d+):in [`'](.+?)': ([\s\S]*?)(?: \(([\w:]+)\))?$/.exec(line.trim());
    if (top) {
      sections.push((current = { relation: sections.length === 0 ? null : "cause", type: top[5] ?? "", message: top[4]!, frames: [frame(top[3]!, top[1]!, top[2])] }));
      continue;
    }
    if (current && line.trim() !== "" && current.frames.length === 1 && !/^\s/.test(line)) {
      const tail = /^(.*?)(?: \(([\w:]+)\))?$/.exec(line.trim())!;
      current.message += `\n${tail[1]}`;
      if (tail[2]) current.type = tail[2];
    }
  }
  return sections;
}

/** Frames as rows: app frames alone, runs of two or more library frames folded into one row. */
export type FrameRow = { kind: "frame"; index: number } | { kind: "fold"; start: number; count: number };
export function frameRows(frames: readonly Frame[]): FrameRow[] {
  const rows: FrameRow[] = [];
  for (let i = 0; i < frames.length; ) {
    let end = i;
    while (end < frames.length && frames[end]!.library) end++;
    if (end - i >= 2) {
      rows.push({ kind: "fold", start: i, count: end - i });
      i = end;
    } else {
      rows.push({ kind: "frame", index: i });
      i++;
    }
  }
  return rows;
}
