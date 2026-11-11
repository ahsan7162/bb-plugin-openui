// Test results from vitest/jest --json, JUnit XML, or an inline list
// [{name, status, message?, file?, line?}]. Pure.
import { isObj, list, num, shortenPaths, str, stripAnsi, tryJson } from "./common";
import { findAll, parseXml } from "./xml";

export type TestStatus = "passed" | "failed" | "skipped";
export interface TestCase {
  name: string;
  status: TestStatus;
  message?: string;
  file?: string;
  line?: number;
  ms?: number;
}
export interface TestRun {
  cases: TestCase[];
  counts: Record<TestStatus, number>;
}

const USAGE = "Tests reads vitest or jest --json output, JUnit XML, or [{name, status, message?, file?, line?}]";

export function status(value: unknown): TestStatus {
  const s = String(value ?? "").toLowerCase();
  if (/^(pass|passed|success|ok)$/.test(s)) return "passed";
  if (/^(fail|failed|failure|error|broken)$/.test(s)) return "failed";
  return "skipped"; // pending, todo, skipped, disabled, focused-out
}

export function parseTests(input: string | unknown[]): TestRun {
  const cases = Array.isArray(input) ? fromInline(input) : fromText(input);
  const short = shortenPaths(cases.flatMap((c) => (c.file ? [c.file] : [])));
  for (const c of cases) if (c.file) c.file = short(c.file);
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const c of cases) counts[c.status]++;
  return { cases, counts };
}

function fromText(text: string): TestCase[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) return fromJUnit(trimmed);
  const json = tryJson(trimmed);
  if (Array.isArray(json)) return fromInline(json);
  if (isObj(json) && Array.isArray(json.testResults)) return fromJest(json.testResults);
  throw new Error(USAGE);
}

function fromInline(rows: unknown[]): TestCase[] {
  return rows.filter(isObj).flatMap((r) => {
    const name = str(r.name) ?? str(r.title);
    if (!name) return [];
    return [{ name, status: status(r.status), message: str(r.message), file: str(r.file), line: num(r.line), ms: num(r.duration) }];
  });
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** jest and vitest share this shape: testResults[] of files with assertionResults[]. */
function fromJest(files: unknown[]): TestCase[] {
  return files.filter(isObj).flatMap((file): TestCase[] => {
    const path = str(file.name) ?? str(file.testFilePath);
    const assertions = list(file.assertionResults).filter(isObj);
    // A file that failed before any test ran (a syntax error) has only a message.
    if (assertions.length === 0 && status(file.status) === "failed") {
      return [{ name: path ?? "Test file", status: "failed", message: clean(str(file.message) ?? str(file.failureMessage)), file: path }];
    }
    return assertions.map((a) => {
      const message = clean(list(a.failureMessages).filter((m): m is string => typeof m === "string").join("\n\n"));
      const titles = [...list(a.ancestorTitles).filter((t): t is string => typeof t === "string"), str(a.title) ?? ""];
      const location = isObj(a.location) ? num(a.location.line) : undefined;
      return {
        name: str(a.fullName) ?? titles.filter(Boolean).join(" > "),
        status: status(a.status),
        message,
        file: path,
        line: location ?? (path && message ? lineInStack(message, path) : undefined),
        ms: num(a.duration),
      };
    });
  });
}

const clean = (text: string | undefined) => (text ? stripAnsi(text).trim() || undefined : undefined);

/** The first "file:line" in a stack trace that points into the test file. */
function lineInStack(message: string, path: string): number | undefined {
  const base = path.split("/").pop()!;
  const match = new RegExp(`${escapeRe(base)}:(\\d+)(?::\\d+)?`).exec(message);
  return match ? Number(match[1]) : undefined;
}

function fromJUnit(xml: string): TestCase[] {
  const root = parseXml(xml);
  const found = findAll(root, "testcase");
  if (found.length === 0 && findAll(root, "testsuite").length === 0 && findAll(root, "testsuites").length === 0) throw new Error(USAGE);
  return found.map(({ element, ancestors }) => {
    const suite = [...ancestors].reverse().find((a) => a.name === "testsuite");
    const outcome = element.children.find((c) => c.name === "failure" || c.name === "error" || c.name === "skipped");
    const headline = outcome?.attrs.message?.trim();
    const body = outcome?.text.trim();
    const message = headline && body && !body.includes(headline) ? `${headline}\n\n${body}` : body || headline || undefined;
    const classname = element.attrs.classname;
    // vitest puts the file in classname; pytest and JUnit put a dotted class there.
    const isPath = classname !== undefined && /[/\\]|\.(m?[jt]sx?|cjs|py|rb|go)$/.test(classname);
    const file = element.attrs.file ?? suite?.attrs.file ?? (isPath ? classname : undefined);
    const name = element.attrs.name ?? "Unnamed test";
    const time = num(element.attrs.time);
    return {
      name: classname && !isPath && classname !== suite?.attrs.name ? `${classname} > ${name}` : name,
      status: outcome === undefined ? "passed" : outcome.name === "skipped" ? "skipped" : "failed",
      message: outcome?.name === "skipped" ? headline : clean(message),
      file,
      line: num(element.attrs.line),
      ms: time === undefined ? undefined : time * 1000,
    };
  });
}
