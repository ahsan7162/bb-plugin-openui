// Workspace files: components that show the thread's own files inline in a
// reply: a code snippet, a file link, an image, a build log, a stack trace and
// transcripts compared word by word. Each reads through useThreadFile; the
// parsers they use are pure, in ./files/, and tested in files.test.ts.
import { useContext, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Markdown, experimental_FileLink as FileLink, useSdk } from "@get-bb/plugin-sdk/app";
import { defineComponent } from "@openuidev/react-lang";
import { ChevronRight, CircleCheck, CircleX, FileText } from "lucide-react";
import { z } from "zod/v4";
import { FenceContext, useThreadFile } from "../data";
import { Button, EmptyState, ErrorState, LoadedView, Skeleton, cx, fmt, useStreaming } from "./kit";
import type { ExtraGroup } from "./types";
import { imageSize } from "./files/image";
import { exitWords, parseLog, type Log, type Run } from "./files/logs";
import { fence, fileTarget, framePath, isPath, languageOf, sliceLines, splitPath, type ThreadEnv } from "./files/paths";
import { LANGUAGE_NAMES, frameRows, parseTrace, type Frame, type Relation, type Trace } from "./files/stack";
import { compare, wordsFromJson, wordsFromText, type Word } from "./files/transcript";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

// ---------------------------------------------------------------------------
// Reading files and opening them

/** False on the server and the first client render: the SDK's data hooks only exist once mounted in BB. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const envs = new Map<string, Promise<ThreadEnv | null>>();

/** The reply thread's environment (id, root path, host), fetched once per thread. */
function useThreadEnv(threadId: string | null): ThreadEnv | null {
  const sdk = useSdk();
  const [env, setEnv] = useState<ThreadEnv | null>(null);
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    let pending = envs.get(threadId);
    if (!pending) {
      pending = sdk.threads
        .get({ threadId, include: "environment" })
        .then((thread) => {
          const environment = "environment" in thread ? (thread.environment as { path?: unknown; hostId?: unknown } | null) : null;
          return {
            environmentId: thread.environmentId,
            path: typeof environment?.path === "string" ? environment.path : null,
            hostId: typeof environment?.hostId === "string" ? environment.hostId : null,
          };
        })
        .catch(() => {
          envs.delete(threadId);
          return null;
        });
      envs.set(threadId, pending);
    }
    void pending.then((value) => live && setEnv(value));
    return () => {
      live = false;
    };
  }, [sdk, threadId]);
  return env;
}

interface RefProps {
  path: string;
  line?: number | null;
  endLine?: number | null;
  className?: string;
  children: ReactNode;
}

function LinkedFile({ path, line, endLine, className, children }: RefProps) {
  const threadId = useContext(FenceContext)?.threadId ?? null;
  const env = useThreadEnv(path.startsWith("$BB_THREAD_STORAGE/") ? null : threadId);
  const target = fileTarget(path, threadId, env);
  if (target === null) return <span className={className}>{children}</span>;
  const start = line && line > 0 ? Math.floor(line) : null;
  const location =
    start === null ? null : endLine && endLine > start ? { kind: "range" as const, startLine: start, endLine: Math.floor(endLine) } : { kind: "line" as const, line: start, column: null };
  return (
    <FileLink target={target} location={location} className={cx(className, "bbui-files-link")} title={`Open ${path} in BB`}>
      {children}
    </FileLink>
  );
}

/** A path that opens the file in BB once the thread's environment is known; plain text until then. */
function FileRef(props: RefProps) {
  const mounted = useMounted();
  return mounted ? <LinkedFile {...props} /> : <span className={props.className}>{props.children}</span>;
}

type ViewProps<T> = Omit<Parameters<typeof LoadedView<T>>[0], "loaded">;

function ReadFile<T>({ path, media, ...view }: ViewProps<T> & { path: string; media?: boolean }) {
  const loaded = useThreadFile(path, { media: media ?? false });
  return <LoadedView {...view} loaded={loaded} />;
}

/**
 * A region drawn from `value`: inline text as it is, or a path read from the
 * thread's files once the block stops streaming (a half-streamed path is no file).
 */
function Source<T>({ value, media, ...view }: ViewProps<T> & { value: string; media?: boolean }) {
  const mounted = useMounted();
  const streaming = useStreaming();
  if (!media && !isPath(value)) {
    if (streaming) {
      // Half-streamed text may not parse yet; that is no error to show.
      try {
        view.parse(value);
      } catch {
        return <>{view.skeleton ?? <Skeleton />}</>;
      }
    }
    return <LoadedView {...view} loaded={{ state: "ready", value }} />;
  }
  if (!mounted || streaming || value.trim() === "") return <>{view.skeleton ?? <Skeleton />}</>;
  return <ReadFile {...view} path={value.trim()} media={media} />;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n, { decimals: 0 })} ${n === 1 ? one : many}`;

function PathLabel({ path, line }: { path: string; line?: number | null }) {
  const { dir, base } = splitPath(path);
  return (
    <span className="bbui-files-pathtext">
      {dir ? <span className="bbui-files-dir">{dir}</span> : null}
      <span className="bbui-files-base">{base}</span>
      {line ? <span className="bbui-files-dir">:{line}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// File

const File = defineComponent({
  name: "File",
  description: "A compact link to one workspace or thread-storage file that opens it in BB, optionally at a line.",
  props: z.object({ path: z.string(), line: z.number().optional() }),
  component: ({ props }) => {
    const path = text(props.path);
    const line = count(props.line);
    return (
      <div className="bbui bbui-files-file">
        <FileRef path={path} line={line} className="bbui-files-fileref">
          <FileText {...ICON} />
          <PathLabel path={path} line={line} />
        </FileRef>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// Snippet

const Snippet = defineComponent({
  name: "Snippet",
  description: "Lines from..to (1-based, inclusive; omit for the whole file) of a file, numbered and highlighted, with a link that opens it at those lines.",
  props: z.object({ path: z.string(), from: z.number().optional(), to: z.number().optional() }),
  component: ({ props }) => {
    const path = text(props.path);
    const from = count(props.from);
    const to = count(props.to);
    const expected = from !== null && to !== null ? Math.min(12, Math.max(1, to - from + 1)) : 8;
    return (
      <figure className="bbui bbui-files bbui-files-snippet">
        <figcaption className="bbui-files-head">
          <FileRef path={path} line={from} endLine={to} className="bbui-files-fileref">
            <FileText {...ICON} />
            <PathLabel path={path} />
          </FileRef>
          {from !== null ? <span className="bbui-label">{to !== null && to !== from ? `lines ${from} to ${to}` : `line ${from}`}</span> : null}
        </figcaption>
        <Source
          value={path}
          parse={(content) => sliceLines(content, from, to)}
          isEmpty={(slice) => slice.total === 1 && slice.lines[0] === ""}
          empty={{ title: "This file is empty", hint: "Write to it, or point the snippet at another file." }}
          errorTitle="This snippet could not be read"
          skeleton={<div className="bbui-files-code"><Skeleton lines={expected} /></div>}
        >
          {(slice) => (
            <div className="bbui-files-code" style={{ "--bbui-files-digits": `${String(slice.start + slice.lines.length - 1).length}ch` } as CSSProperties}>
              <div className="bbui-files-gutter" aria-hidden="true">
                {slice.lines.map((_, i) => (
                  <span key={i}>{slice.start + i}</span>
                ))}
              </div>
              <Markdown content={fence(slice.lines.join("\n"), languageOf(path))} className="bbui-files-markdown" />
            </div>
          )}
        </Source>
      </figure>
    );
  },
});

// ---------------------------------------------------------------------------
// FileImage

function ImageView({ src, alt }: { src: string; alt: string }) {
  const size = imageSize(src);
  return (
    <img
      className="bbui-files-img"
      src={src}
      alt={alt}
      width={size?.width}
      height={size?.height}
      style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
    />
  );
}

const FileImage = defineComponent({
  name: "FileImage",
  description: "An image file (png, jpg, gif, webp, svg, avif) from the workspace or thread storage, at its natural aspect ratio.",
  props: z.object({ path: z.string(), alt: z.string().optional() }),
  component: ({ props }) => {
    const path = text(props.path);
    const alt = text(props.alt);
    return (
      <figure className="bbui bbui-files bbui-files-image">
        <Source
          value={path}
          media
          parse={(src) => src}
          empty={{ title: "This image is empty", hint: "Save the image again, then reload the reply." }}
          errorTitle="This image could not be shown"
          skeleton={<div className="bbui-files-imgskeleton"><Skeleton height={240} /></div>}
        >
          {(src) => <ImageView src={src} alt={alt || splitPath(path).base} />}
        </Source>
        <figcaption className="bbui-files-head">
          {alt ? <span>{alt}</span> : null}
          <FileRef path={path} className="bbui-files-fileref bbui-label">
            <PathLabel path={path} />
          </FileRef>
        </figcaption>
      </figure>
    );
  },
});

// ---------------------------------------------------------------------------
// Logs

/** Lines kept on screen before "Show all"; the end of a log is where a failure usually is. */
const TAIL = 150;

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.tone || run.bold ? (
          <span key={i} data-tone={run.tone} data-bold={run.bold || undefined}>
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

function LogView({ log }: { log: Log }) {
  const id = useId();
  const scroller = `${id}-log`;
  const [expanded, setExpanded] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const hidden = !expanded && log.lines.length > TAIL + 30 ? log.lines.length - TAIL : 0;

  useEffect(() => {
    const box = document.getElementById(scroller);
    if (box) box.scrollTop = box.scrollHeight;
  }, [scroller]);
  useEffect(() => {
    if (current !== null) document.getElementById(`${id}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [id, current, expanded]);

  const jump = (list: number[]) => {
    const next = list.find((i) => current === null || i > current) ?? list[0]!;
    if (next < hidden) setExpanded(true);
    setCurrent(next);
  };
  const width = `${String(log.lines[log.lines.length - 1]?.n ?? 1).length}ch`;

  return (
    <div className="bbui-files-logbody">
      <div className="bbui-files-bar">
        {log.errors.length > 0 ? (
          <Button onClick={() => jump(log.errors)} aria-controls={scroller}>
            {plural(log.errors.length, "error")}
          </Button>
        ) : null}
        {log.warnings.length > 0 ? (
          <Button onClick={() => jump(log.warnings)} aria-controls={scroller}>
            {plural(log.warnings.length, "warning")}
          </Button>
        ) : null}
        {log.errors.length + log.warnings.length === 0 ? <span className="bbui-label">No errors or warnings</span> : null}
        <span className="bbui-label bbui-files-count">{plural(log.lines.length, "line")}</span>
      </div>
      <div className="bbui-files-log" id={scroller} tabIndex={0} aria-label="Log output" style={{ "--bbui-files-digits": width } as CSSProperties}>
        {hidden > 0 ? (
          <div className="bbui-files-more">
            <span className="bbui-label">
              {plural(hidden, "earlier line")} hidden
            </span>
            <Button onClick={() => setExpanded(true)}>Show all {fmt(log.lines.length, { decimals: 0 })} lines</Button>
          </div>
        ) : null}
        <ol className="bbui-files-loglines">
          {log.lines.slice(hidden).map((line, i) => {
            const index = hidden + i;
            return (
              <li key={index} id={`${id}-${index}`} data-level={line.level ?? undefined} data-current={index === current || undefined}>
                <span className="bbui-files-ln">{line.n}</span>
                <span className="bbui-files-lt">
                  {line.level ? <span className="bbui-files-sr">{line.level === "error" ? "Error: " : "Warning: "}</span> : null}
                  <Runs runs={line.runs} />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const Logs = defineComponent({
  name: "Logs",
  description: "Build or server output: source is a log file path or the text itself (ANSI and JSONL fine); errors and warnings counted and jumpable. exit 0 reads as success.",
  props: z.object({ source: z.string(), command: z.string().optional(), exit: z.number().optional() }),
  component: ({ props }) => {
    const source = text(props.source);
    const command = text(props.command);
    const exit = count(props.exit);
    return (
      <section className="bbui bbui-files bbui-files-logs" aria-label={command ? `Output of ${command}` : "Log output"}>
        {command || exit !== null ? (
          <header className="bbui-files-head">
            {command ? <code className="bbui-mono bbui-files-command">$ {command}</code> : null}
            {exit !== null ? (
              <span className="bbui-files-exit" data-ok={exit === 0}>
                {exit === 0 ? <CircleCheck {...ICON} /> : <CircleX {...ICON} />}
                {exitWords(exit)}
              </span>
            ) : null}
          </header>
        ) : null}
        <Source
          value={source}
          parse={parseLog}
          isEmpty={(log) => log.lines.length === 0}
          empty={{ title: "The log is empty", hint: "The command printed nothing; run it again with more output, or check the path." }}
          errorTitle="This log could not be read"
          skeleton={
            <div className="bbui-files-logbody">
              <div className="bbui-files-bar"><Skeleton lines={1} /></div>
              <div className="bbui-files-log"><Skeleton lines={8} /></div>
            </div>
          }
        >
          {(log) => <LogView log={log} />}
        </Source>
      </section>
    );
  },
});

// ---------------------------------------------------------------------------
// StackTrace

const RELATION_WORDS: Record<Relation, string> = { cause: "Caused by", context: "While handling", suppressed: "Suppressed" };

function FrameItem({ frame }: { frame: Frame }) {
  const path = framePath(frame.file);
  const where = frame.file === null ? null : `${splitPath(frame.file).base}${frame.line !== null ? `:${frame.line}` : ""}${frame.col !== null ? `:${frame.col}` : ""}`;
  return (
    <li className="bbui-files-frame" data-library={frame.library || undefined}>
      <code className="bbui-files-fn">{frame.fn || "anonymous"}</code>
      {where === null ? null : path === null ? (
        <span className="bbui-files-where" title={frame.file ?? undefined}>{where}</span>
      ) : (
        <FileRef path={path} line={frame.line} className="bbui-files-where">
          <span title={frame.file ?? undefined}>{where}</span>
        </FileRef>
      )}
    </li>
  );
}

function TraceView({ trace, title }: { trace: Trace; title: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <>
      <header className="bbui-files-head">
        {title ? <span className="bbui-head">{title}</span> : null}
        <span className="bbui-label">{LANGUAGE_NAMES[trace.language]}</span>
      </header>
      {trace.sections.map((section, s) => (
        <section key={s} className="bbui-files-section" data-first={s === 0 || undefined}>
          {section.relation ? <span className="bbui-label">{RELATION_WORDS[section.relation]}</span> : null}
          <p className="bbui-files-error">
            {s === 0 ? <CircleX {...ICON} className="bbui-files-erricon" /> : null}
            <span>
              {section.type ? <code className="bbui-files-type">{section.type}</code> : null}
              {section.type && section.message ? " " : null}
              {section.message}
            </span>
          </p>
          {section.frames.length > 0 ? (
            <ol className="bbui-files-frames" aria-label={`${plural(section.frames.length, "frame")}, innermost first`}>
              {frameRows(section.frames).map((row) => {
                if (row.kind === "frame") return <FrameItem key={row.index} frame={section.frames[row.index]!} />;
                const key = `${s}-${row.start}`;
                const shown = open.has(key);
                return (
                  <li key={key} className="bbui-files-fold">
                    <Button aria-expanded={shown} onClick={() => toggle(key)}>
                      <ChevronRight {...ICON} className="bbui-files-chevron" />
                      {shown ? "Hide" : "Show"} {plural(row.count, "library frame")}
                    </Button>
                    {shown ? (
                      <ol className="bbui-files-frames">
                        {section.frames.slice(row.start, row.start + row.count).map((frame, i) => (
                          <FrameItem key={i} frame={frame} />
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>
      ))}
    </>
  );
}

const StackTrace = defineComponent({
  name: "StackTrace",
  description: "An error and its stack (JS/TS, Python, Java/Kotlin, Go, Rust, Ruby): trace is the printed text or a file path. App frames lead; library frames fold.",
  props: z.object({ trace: z.string(), title: z.string().optional() }),
  component: ({ props }) => {
    const title = text(props.title);
    return (
      <section className="bbui bbui-files bbui-files-trace" aria-label={title || "Stack trace"}>
        <Source
          value={text(props.trace)}
          parse={parseTrace}
          empty={{ title: "No trace" }}
          errorTitle="This stack trace could not be read"
          skeleton={
            <>
              <Skeleton lines={1} />
              <Skeleton lines={5} />
            </>
          }
        >
          {(trace) => <TraceView trace={trace} title={title} />}
        </Source>
      </section>
    );
  },
});

// ---------------------------------------------------------------------------
// Transcript

const TranscriptTrack = defineComponent({
  name: "TranscriptTrack",
  description: "One transcript: text, or source, a JSON file of words [{text, start, end, speaker?}].",
  props: z.object({ name: z.string(), text: z.string().optional(), source: z.string().optional() }),
  component: () => null,
});

type TrackProps = { name?: unknown; text?: unknown; source?: unknown };

function parseWords(path: string) {
  return (content: string) => (/\.json$/i.test(path) ? wordsFromJson(content) : wordsFromText(content));
}

/** A track's words: its source file read, or its text split. */
function TrackWords({ track, children }: { track: TrackProps; children: (words: Word[]) => ReactNode }) {
  const source = text(track.source).trim();
  const empty = { title: "This track has no words", hint: "Give it text, or a source file of words." };
  if (source) {
    return (
      <Source value={source} parse={parseWords(source)} isEmpty={(w) => w.length === 0} empty={empty} errorTitle="This track could not be read" skeleton={<Skeleton lines={3} />}>
        {children}
      </Source>
    );
  }
  const words = wordsFromText(text(track.text));
  return words.length === 0 ? <EmptyState {...empty} /> : <>{children(words)}</>;
}

function clock(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A speaker's name (and start time) where the speaker changes. */
function Turn({ word, previous }: { word: Word | undefined; previous: Word | undefined }) {
  if (!word?.speaker || word.speaker === previous?.speaker) return null;
  const at = clock(word.start);
  return (
    <span className="bbui-files-speaker">
      {word.speaker}
      {at ? <span className="bbui-files-at"> {at}</span> : null}
    </span>
  );
}

function ReferenceText({ words }: { words: Word[] }) {
  return (
    <p className="bbui-files-words">
      {words.map((word, i) => (
        <span key={i}>
          <Turn word={word} previous={words[i - 1]} />
          {word.text}{" "}
        </span>
      ))}
    </p>
  );
}

function TrackDiff({ name, reference, words }: { name: string; reference: Word[]; words: Word[] }) {
  let result: ReturnType<typeof compare>;
  try {
    result = compare(reference, words);
  } catch (cause) {
    return <ErrorState title={`${name} could not be compared`} detail={cause instanceof Error ? cause.message : String(cause)} />;
  }
  const { ops, score, ref, hyp } = result;
  let lastHyp: Word | undefined;
  return (
    <section className="bbui-files-track" aria-label={name}>
      <header className="bbui-files-trackhead">
        <span className="bbui-head">{name}</span>
        <span className="bbui-files-wer">
          <span className="bbui-figure">{fmt(score.wer * 100, { decimals: 1 })}%</span>
          <span className="bbui-label">word error rate</span>
        </span>
      </header>
      <span className="bbui-label">
        {plural(score.sub, "substitution")}, {plural(score.del, "deletion")}, {plural(score.ins, "insertion")} against {plural(score.words, "reference word")}
      </span>
      <p className="bbui-files-words">
        {ops.map((op, i) => {
          const h = op.h === undefined ? undefined : hyp[op.h];
          const r = op.r === undefined ? undefined : ref[op.r];
          const turn = h ? <Turn word={h} previous={lastHyp} /> : null;
          if (h) lastHyp = h;
          if (op.kind === "match") return <span key={i}>{turn}{h!.text} </span>;
          if (op.kind === "del") return <span key={i}><del title="Missing from this track">{r!.text}</del> </span>;
          if (op.kind === "ins") return <span key={i}>{turn}<ins title="Not in the reference">{h!.text}</ins> </span>;
          return (
            <span key={i}>
              {turn}
              <mark className="bbui-files-sub" title={`Reference says "${r!.text}"`}>
                <del>{r!.text}</del> <ins>{h!.text}</ins>
              </mark>{" "}
            </span>
          );
        })}
      </p>
    </section>
  );
}

const Transcript = defineComponent({
  name: "Transcript",
  description: "Transcripts compared word by word: the first track is the reference; each other track gets its word error rate and its substitutions, deletions and insertions marked.",
  props: z.object({ tracks: z.array(TranscriptTrack.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const tracks = (Array.isArray(props.tracks) ? props.tracks : []).map((t) => ((t as { props?: TrackProps })?.props ?? {}) as TrackProps);
    const [reference, ...others] = tracks;
    if (!reference) return <div className="bbui bbui-files"><Skeleton lines={4} /></div>;
    return (
      <div className="bbui bbui-files bbui-files-transcript">
        <TrackWords track={reference}>
          {(refWords) => (
            <>
              <section className="bbui-files-track" aria-label={`${text(reference.name) || "Reference"}, the reference`}>
                <header className="bbui-files-trackhead">
                  <span className="bbui-head">{text(reference.name) || "Reference"}</span>
                  <span className="bbui-label">Reference, {plural(refWords.length, "word")}</span>
                </header>
                <ReferenceText words={refWords} />
              </section>
              {others.map((track, i) => (
                <TrackWords key={i} track={track}>
                  {(words) => (streaming ? <Skeleton lines={3} /> : <TrackDiff name={text(track.name) || `Track ${i + 2}`} reference={refWords} words={words} />)}
                </TrackWords>
              ))}
              {others.length > 0 ? (
                <p className="bbui-label bbui-files-legend">
                  <del>struck</del> missing from the track, <ins>underlined</ins> added by it, <mark className="bbui-files-sub">marked</mark> substituted (reference word struck first).
                </p>
              ) : null}
            </>
          )}
        </TrackWords>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------

const TRANSCRIPT_EXAMPLE = `root = Stack([cmp])
cmp = Transcript([ref, base, tiny])
ref = TranscriptTrack("Reference", "Yes I can hear you fine. Great, we have twenty five minutes, so let us look at the transcript.")
base = TranscriptTrack("whisper base.en", "Yes I can hear you fine. Great, we have twenty five minutes so let's look at the transcript.")
tiny = TranscriptTrack("whisper tiny.en", "Yes I can here you. Great we have twenty minutes so let us look at a transcript today.")`;

export const filesGroup: ExtraGroup = {
  name: "Workspace files",
  notes: [
    'Paths are workspace-relative, "$BB_THREAD_STORAGE/..." or "/tmp/..."; write the file first, then show it.',
    "Logs and StackTrace take a file path or the text itself; long logs open at their tail.",
  ],
  components: [Snippet, File, FileImage, Logs, StackTrace, Transcript, TranscriptTrack],
  examples: {
    Snippet: `root = Stack([intro, code])
intro = TextContent("The retry backoff lives here:")
code = Snippet("$BB_THREAD_STORAGE/retry.ts", 4, 12)`,
    File: `root = Stack([intro, a, b])
intro = TextContent("Files to change:")
a = File("src/worker/queue.ts", 42)
b = File("$BB_THREAD_STORAGE/notes/plan.md")`,
    FileImage: `root = Stack([shot])
shot = FileImage("$BB_THREAD_STORAGE/screenshots/checkout.png", "Checkout page after the fix")`,
    Logs: `root = Stack([log])
log = Logs("> shop@1.4.0 build\\n> tsc && vite build\\n\\nvite v5.4.2 building for production...\\n[warn] src/cart.ts: 'formatEur' is deprecated, use 'money()'\\ntransforming (212) src/pages/checkout.tsx\\nsrc/pricing.ts(10,23): error TS2339: Property 'toEur' does not exist on type 'Price'.\\nFound 1 error in src/pricing.ts:10", "npm run build", 1)`,
    StackTrace: `root = Stack([trace])
trace = StackTrace("TypeError: Cannot read properties of undefined (reading 'toEur')\\n    at lineTotal (src/pricing.ts:10:23)\\n    at Array.map (<anonymous>)\\n    at cartTotal (src/cart.ts:31:18)\\n    at Layer.handle (node_modules/express/lib/router/layer.js:95:5)\\n    at next (node_modules/express/lib/router/route.js:149:13)\\n    at checkout (src/routes/checkout.ts:12:9)", "POST /checkout failed")`,
    Transcript: TRANSCRIPT_EXAMPLE,
    TranscriptTrack: TRANSCRIPT_EXAMPLE,
  },
};
