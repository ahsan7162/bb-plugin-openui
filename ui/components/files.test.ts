import { test } from "node:test";
import assert from "node:assert/strict";
import { ansiRuns, exitWords, parseLog, recordLine, stripAnsi, textLevel } from "./files/logs";
import { fence, fileTarget, framePath, isPath, languageOf, sliceLines } from "./files/paths";
import { frameRows, parseTrace } from "./files/stack";
import { align, compare, normalize, score, wordsFromJson, wordsFromText } from "./files/transcript";
import { imageSize } from "./files/image";

const env = { environmentId: "env_1", path: "/work/repo", hostId: "host_1" };

test("paths: a path or inline text", () => {
  for (const p of ["$BB_THREAD_STORAGE/build.log", "/tmp/out.txt", "./a.log", "src/app.ts", "build.log", "Dockerfile.dev"]) assert.equal(isPath(p), true, p);
  for (const t of ["error: x failed", "line one\nline two", "", "Hello world.", "npm ERR! code 1"]) assert.equal(isPath(t), false, t);
});

test("paths: BB file targets", () => {
  assert.deepEqual(fileTarget("$BB_THREAD_STORAGE/out/a.png", "thr", env), { kind: "thread-storage", threadId: "thr", path: "out/a.png" });
  assert.deepEqual(fileTarget("./src/a.ts", "thr", env), { kind: "workspace", environmentId: "env_1", path: "src/a.ts" });
  assert.deepEqual(fileTarget("/work/repo/src/a.ts", "thr", env), { kind: "workspace", environmentId: "env_1", path: "src/a.ts" });
  assert.deepEqual(fileTarget("/tmp/x.log", "thr", env), { kind: "host", hostId: "host_1", path: "/tmp/x.log" });
  assert.equal(fileTarget("src/a.ts", "thr", null), null);
  assert.equal(fileTarget("../outside.ts", "thr", env), null);
});

test("paths: frame files that can be opened", () => {
  assert.equal(framePath("http://localhost:5173/src/App.tsx?t=1"), "src/App.tsx");
  assert.equal(framePath("/app/src/a.ts"), "/app/src/a.ts");
  assert.equal(framePath("./src/main.rs"), "./src/main.rs");
  for (const f of ["Invoice.kt", "<anonymous>", "node:internal/modules/cjs/loader", null]) assert.equal(framePath(f), null, String(f));
});

test("paths: languages, slices and fences", () => {
  assert.equal(languageOf("src/a.tsx"), "tsx");
  assert.equal(languageOf("deploy/Dockerfile"), "dockerfile");
  assert.equal(languageOf("notes.unknown"), "");
  assert.deepEqual(sliceLines("a\nb\nc\nd\n", 2, 3), { start: 2, lines: ["b", "c"], total: 4 });
  assert.deepEqual(sliceLines("a\nb", 5, 9), { start: 2, lines: ["b"], total: 2 });
  assert.deepEqual(sliceLines("a\r\nb", undefined, undefined).lines, ["a", "b"]);
  assert.equal(fence("x = ```y```", "md"), "````md\nx = ```y```\n````");
});

test("logs: ANSI colours become tones, other escapes vanish", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m \x1b]0;title\x07\x1b[2Kdone"), "red done");
  assert.deepEqual(ansiRuns("\x1b[1;31mFAIL\x1b[0m src/a.test.ts \x1b[38;5;244m(3ms)\x1b[39m"), [
    { text: "FAIL", tone: "bad", bold: true },
    { text: " src/a.test.ts (3ms)" },
  ]);
  assert.deepEqual(ansiRuns("\x1b[33mwarn\x1b[39m ok \x1b[2mdim\x1b[22m"), [{ text: "warn", tone: "warn" }, { text: " ok " }, { text: "dim", tone: "muted" }]);
});

test("logs: line levels", () => {
  assert.equal(textLevel("ERROR: build failed"), "error");
  assert.equal(textLevel("npm ERR! code ELIFECYCLE"), "error");
  assert.equal(textLevel("warning: unused variable `error`"), "warn");
  assert.equal(textLevel("[warn] slow query"), "warn");
  assert.equal(textLevel("Found 0 errors. Watching for file changes."), null);
  assert.equal(textLevel("    at lineTotal (src/pricing.ts:10:46)"), null);
  assert.equal(textLevel("GET /health 200 2ms"), null);
  assert.equal(textLevel("✖ build failed"), "error");
  assert.equal(textLevel("✖ 2 problems (2 errors, 0 warnings)"), null);
  assert.equal(textLevel("Found 1 error in src/pricing.ts:10"), null);
});

test("logs: JSON records read as lines", () => {
  const line = recordLine('{"level":50,"time":1767225600000,"pid":1,"msg":"upload failed","err":{"message":"ECONNRESET"},"job":"j_42"}');
  assert.equal(line?.level, "error");
  assert.equal(line?.runs.map((r) => r.text).join(""), "00:00:00 error upload failed ECONNRESET  job=j_42");
  assert.equal(recordLine('{"level":"warning","message":"disk at 91%"}')?.level, "warn");
  assert.equal(recordLine('{"level":"info","msg":"ok"}')?.level, null);
  assert.equal(recordLine("{not json}"), null);
});

test("logs: parse counts errors and warnings and keeps the last redraw", () => {
  const log = parseLog("start\r\n[warn] slow\nprogress 10%\rprogress 100%\nerror: boom\n    at x (a.js:1:1)\n");
  assert.deepEqual(log.lines.map((l) => l.text), ["start", "[warn] slow", "progress 100%", "error: boom", "    at x (a.js:1:1)"]);
  assert.deepEqual(log.errors, [3]);
  assert.deepEqual(log.warnings, [1]);
  assert.equal(log.lines[4]!.n, 5);
  assert.deepEqual(parseLog("").lines, []);
  assert.equal(exitWords(0), "Succeeded, exit code 0");
  assert.equal(exitWords(2), "Failed, exit code 2");
});

test("stack: Node with a cause and a source excerpt", () => {
  const trace = parseTrace(`/app/src/pricing.ts:10
    return item.price.toEur();
                      ^

TypeError: Cannot read properties of undefined (reading 'toEur')
    at lineTotal (/app/src/pricing.ts:10:23)
    at Array.map (<anonymous>)
    at Module._compile (node:internal/modules/cjs/loader:1256:14)
    at Object.require.extensions..js (node:internal/modules/cjs/loader:1310:10)
    at total (file:///app/src/cart.ts:4:18) {
  [cause]: Error: price missing for sku_9
      at load (/app/node_modules/prices/index.js:3:9)
}

Node.js v20.10.0`);
  assert.equal(trace.language, "javascript");
  assert.equal(trace.sections.length, 2);
  const [top, cause] = trace.sections;
  assert.equal(top!.type, "TypeError");
  assert.equal(top!.message, "Cannot read properties of undefined (reading 'toEur')");
  assert.deepEqual(top!.frames[0], { fn: "lineTotal", file: "/app/src/pricing.ts", line: 10, col: 23, library: false });
  assert.equal(top!.frames[2]!.library, true);
  assert.equal(top!.frames[4]!.file, "/app/src/cart.ts");
  assert.equal(cause!.relation, "cause");
  assert.equal(cause!.message, "price missing for sku_9");
  assert.equal(cause!.frames[0]!.library, true);
  assert.deepEqual(frameRows(top!.frames), [
    { kind: "frame", index: 0 },
    { kind: "frame", index: 1 },
    { kind: "fold", start: 2, count: 2 },
    { kind: "frame", index: 4 },
  ]);
});

test("stack: Firefox frames and serialized errors", () => {
  const ff = parseTrace("render@http://localhost:5173/src/App.tsx:12:9\nonClick@http://localhost:5173/node_modules/.vite/react.js:9:1");
  assert.equal(ff.sections[0]!.frames[0]!.fn, "render");
  assert.equal(ff.sections[0]!.frames[1]!.library, true);
  const json = parseTrace(JSON.stringify({ name: "RangeError", message: "bad index", stack: "render@src/a.js:1:2" }));
  assert.equal(json.sections[0]!.type, "RangeError");
  assert.equal(json.sections[0]!.frames.length, 1);
});

test("stack: Python chains, surfaced error first", () => {
  const trace = parseTrace(`Traceback (most recent call last):
  File "/app/deploy.py", line 8, in read_config
    return json.load(f)
  File "/usr/lib/python3.12/json/__init__.py", line 293, in load
    return loads(fp.read())
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/app/deploy.py", line 20, in <module>
    main()
  File "/app/deploy.py", line 10, in main
    raise ConfigError("deploy.json is not valid JSON") from err
ConfigError: deploy.json is not valid JSON`);
  assert.equal(trace.language, "python");
  const [top, cause] = trace.sections;
  assert.equal(top!.type, "ConfigError");
  assert.equal(top!.relation, null);
  assert.deepEqual(top!.frames.map((f) => [f.fn, f.line]), [["main", 10], ["<module>", 20]]);
  assert.equal(cause!.relation, "cause");
  assert.equal(cause!.type, "json.decoder.JSONDecodeError");
  assert.equal(cause!.frames[0]!.library, true);
});

test("stack: Java and Kotlin with causes", () => {
  const trace = parseTrace(`Exception in thread "main" java.lang.IllegalStateException: invoice total mismatch
	at com.acme.billing.Invoice.total(Invoice.kt:42)
	at java.base/java.util.stream.ReferencePipeline.collect(ReferencePipeline.java:682)
	at com.acme.billing.Main.main(Main.kt:9)
Caused by: java.lang.ArithmeticException: / by zero
	at com.acme.billing.Rates.ratio(Rates.kt:7)
	... 2 more`);
  assert.equal(trace.language, "java");
  assert.equal(trace.sections[0]!.type, "java.lang.IllegalStateException");
  assert.deepEqual(trace.sections[0]!.frames.map((f) => f.library), [false, true, false]);
  assert.equal(trace.sections[0]!.frames[1]!.fn, "java.util.stream.ReferencePipeline.collect");
  assert.equal(trace.sections[1]!.relation, "cause");
  assert.equal(trace.sections[1]!.message, "/ by zero");
});

test("stack: Go panics read the panicking goroutine", () => {
  const trace = parseTrace(`panic: runtime error: index out of range [5] with length 3

goroutine 1 [running]:
main.lookup(...)
	/home/me/app/main.go:12
main.main()
	/home/me/app/main.go:20 +0x1d
runtime.goexit()
	/usr/local/go/src/runtime/asm_amd64.s:1650 +0x1
goroutine 6 [sleep]:
main.worker()
	/home/me/app/worker.go:3 +0x5
exit status 2`);
  assert.equal(trace.language, "go");
  const s = trace.sections[0]!;
  assert.equal(s.type, "panic");
  assert.equal(s.message, "runtime error: index out of range [5] with length 3");
  assert.deepEqual(s.frames.map((f) => [f.fn, f.line]), [["main.lookup", 12], ["main.main", 20]]);
});

test("stack: Rust panics, new and old forms", () => {
  const modern = parseTrace(`thread 'main' panicked at src/main.rs:5:9:
index out of bounds: the len is 3 but the index is 5
stack backtrace:
   0: rust_begin_unwind
             at /rustc/82e1608df/library/std/src/panicking.rs:645:5
   1: core::panicking::panic_bounds_check
             at /rustc/82e1608df/library/core/src/panicking.rs:208:5
   2: app::lookup
             at ./src/main.rs:5:9
   3: std::rt::lang_start
note: Some details are omitted, run with \`RUST_BACKTRACE=full\` for a verbose backtrace.`);
  assert.equal(modern.language, "rust");
  const s = modern.sections[0]!;
  assert.equal(s.message, "index out of bounds: the len is 3 but the index is 5");
  assert.deepEqual(s.frames.map((f) => [f.fn, f.file, f.line]), [["thread 'main'", "src/main.rs", 5], ["app::lookup", "./src/main.rs", 5]]);
  const legacy = parseTrace("thread 'main' panicked at 'called `Option::unwrap()` on a `None` value', src/lib.rs:14:22");
  assert.equal(legacy.sections[0]!.message, "called `Option::unwrap()` on a `None` value");
  assert.equal(legacy.sections[0]!.frames[0]!.line, 14);
});

test("stack: Ruby", () => {
  const trace = parseTrace(`app/models/user.rb:12:in \`full_name': undefined method \`upcase' for nil:NilClass (NoMethodError)
	from app/controllers/users_controller.rb:5:in \`show'
	from /usr/local/bundle/gems/actionpack-7.1.0/lib/action_controller/metal.rb:227:in \`dispatch'`);
  assert.equal(trace.language, "ruby");
  const s = trace.sections[0]!;
  assert.equal(s.type, "NoMethodError");
  assert.equal(s.message, "undefined method `upcase' for nil:NilClass");
  assert.deepEqual(s.frames.map((f) => [f.fn, f.library]), [["full_name", false], ["show", false], ["dispatch", true]]);
});

test("stack: text without an error is refused", () => {
  assert.throws(() => parseTrace("   "));
});

test("transcript: normalised Levenshtein alignment and WER", () => {
  assert.equal(normalize("Hello,"), "hello");
  assert.equal(normalize("don’t"), "don't");
  assert.equal(normalize("--"), "");
  const ops = align(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]);
  assert.deepEqual(ops.map((o) => o.kind), ["match", "sub", "match", "match", "ins"]);
  assert.deepEqual(score(ops, 4), { sub: 1, del: 0, ins: 1, words: 4, wer: 0.5 });
  const del = align(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(del, [{ kind: "match", r: 0, h: 0 }, { kind: "del", r: 1 }, { kind: "match", r: 2, h: 1 }]);
  const result = compare(wordsFromText("Hello hello, can you hear me speaking?"), wordsFromText("hello hello Jeremy speaking"));
  assert.equal(result.score.words, 7);
  assert.equal(result.score.sub + result.score.del + result.score.ins, 4);
  assert.equal(score([], 0).wer, 0);
  assert.equal(score([{ kind: "ins", h: 0 }], 0).wer, 1);
});

test("transcript: JSON word lists", () => {
  assert.deepEqual(wordsFromJson('[{"text":"Hi","start":0.1,"end":0.4,"speaker":"A"},{"word":"there"}]'), [
    { text: "Hi", start: 0.1, end: 0.4, speaker: "A" },
    { text: "there" },
  ]);
  assert.deepEqual(wordsFromJson('{"words":["a","b"]}').length, 2);
  assert.deepEqual(wordsFromJson('{"segments":[{"speaker":"B","text":"yes ok"}]}'), [{ text: "yes", speaker: "B" }, { text: "ok", speaker: "B" }]);
  assert.throws(() => wordsFromJson("42"));
});

test("image: sizes from data URL heads", () => {
  const url = (type: string, bytes: number[]) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58, 8, 6, 0, 0, 0];
  assert.deepEqual(imageSize(url("image/png", png)), { width: 800, height: 600 });
  assert.deepEqual(imageSize(url("image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0, 0])), { width: 320, height: 240 });
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0];
  assert.deepEqual(imageSize(url("image/jpeg", jpeg)), { width: 400, height: 300 });
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>').toString("base64")}`;
  assert.deepEqual(imageSize(svg), { width: 120, height: 40 });
  assert.equal(imageSize("data:image/png;base64,AAAA"), null);
  assert.equal(imageSize("not a url"), null);
});
