import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings } from "./findings";

test("eslint JSON: severities 1/2, fix, paths shortened, grouped errors first", () => {
  const eslint = [
    { filePath: "/repo/src/a.ts", messages: [{ ruleId: "no-unused-vars", severity: 1, message: "'x' is unused", line: 3, column: 7 }] },
    {
      filePath: "/repo/src/b.ts",
      messages: [{ ruleId: "eqeqeq", severity: 2, message: "Expected '==='", line: 9, column: 5, fix: { range: [1, 2], text: "===" } }],
    },
    { filePath: "/repo/src/c.ts", messages: [] },
  ];
  const r = parseFindings(JSON.stringify(eslint));
  assert.deepEqual(r.counts, { error: 1, warning: 1, info: 0 });
  assert.deepEqual(r.files.map((f) => f.file), ["b.ts", "a.ts"]);
  assert.match(r.files[0]!.findings[0]!.fix!, /Autofix/);
});

test("ruff JSON", () => {
  const ruff = [
    { code: "F401", filename: "/p/app/x.py", location: { row: 2, column: 8 }, message: "`os` imported but unused", fix: { message: "Remove unused import: `os`" } },
    { code: "E501", filename: "/p/app/y.py", location: { row: 1, column: 89 }, message: "Line too long", fix: null },
  ];
  const r = parseFindings(JSON.stringify(ruff));
  assert.equal(r.findings[0]!.rule, "F401");
  assert.equal(r.findings[0]!.line, 2);
  assert.equal(r.findings[0]!.fix, "Remove unused import: `os`");
  assert.equal(r.findings[1]!.fix, undefined);
});

test("biome (path as string or {file}) and oxlint share diagnostics", () => {
  const biome = {
    diagnostics: [
      { severity: "error", message: "Unused import", category: "lint/correctness/noUnusedImports", location: { path: "src/a.ts", start: { line: 1, column: 1 } }, advices: [] },
      { severity: "information", message: "Use const", category: "lint/style/useConst", location: { path: { file: "src/b.ts" } }, advices: [{ text: "Safe fix: Use const instead." }] },
    ],
  };
  const b = parseFindings(JSON.stringify(biome));
  assert.deepEqual(b.counts, { error: 1, warning: 0, info: 1 });
  assert.equal(b.findings[1]!.file, "b.ts"); // the shared src/ is dropped
  assert.equal(b.findings[1]!.fix, "Safe fix: Use const instead.");
  const oxlint = { diagnostics: [{ message: "'a' is unused", code: "eslint(no-unused-vars)", severity: "warning", help: "Remove it.", filename: "src/m.ts", labels: [{ span: { line: 66, column: 9 } }] }] };
  const o = parseFindings(JSON.stringify(oxlint));
  assert.equal(o.findings[0]!.line, 66);
  assert.equal(o.findings[0]!.fix, "Remove it.");
  assert.equal(o.findings[0]!.severity, "warning");
});

test("SARIF", () => {
  const sarif = {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "ESLint" } },
        results: [
          { ruleId: "no-eval", level: "error", message: { text: "eval is evil" }, locations: [{ physicalLocation: { artifactLocation: { uri: "file:///w/src/z.js" }, region: { startLine: 4, startColumn: 2 } } }] },
          { ruleId: "note-rule", level: "note", message: { text: "consider" } },
          { ruleId: "default-level", message: { text: "no level" } },
        ],
      },
    ],
  };
  const r = parseFindings(JSON.stringify(sarif));
  assert.deepEqual(r.counts, { error: 1, warning: 1, info: 1 });
  assert.equal(r.findings[0]!.file, "/w/src/z.js");
  assert.equal(r.findings[0]!.line, 4);
});

test("tsc text with continuation lines and a global error", () => {
  const tsc = `src/a.ts(49,52): error TS2322: Type 'number' is not assignable to type 'string'.
src/b.ts(74,20): error TS2345: Argument of type '{ x: number; }' is not assignable.
  Property 'zoom' is missing.
error TS6053: File 'missing.ts' not found.
Found 3 errors.`;
  const r = parseFindings(tsc);
  assert.equal(r.findings.length, 3);
  assert.equal(r.findings[1]!.detail, "Property 'zoom' is missing.");
  assert.equal(r.findings[1]!.rule, "TS2345");
  assert.equal(r.findings[2]!.file, undefined);
  assert.deepEqual(parseFindings("").findings, []);
});

test("inline rows and unknown input", () => {
  const r = parseFindings([{ severity: "warning", title: "Retry has no cap", file: "src/retry.ts", line: 12, fix: "Stop after 5 tries", status: "open" }, { severity: "error" }]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0]!.status, "open");
  assert.throws(() => parseFindings('{"a": 1}'), /eslint/);
  assert.throws(() => parseFindings("hello world"), /eslint/);
});

test("a review file: {findings: [...]} with P1/P2 severities, issue and evidence", () => {
  const review = { verdict: "fix-required", findings: [{ severity: "P1", issue: "Text fails contrast", evidence: "3.1:1 measured", status: "deferred" }, { severity: "P2", title: "Slow first paint" }] };
  const r = parseFindings(JSON.stringify(review));
  assert.deepEqual(r.counts, { error: 1, warning: 1, info: 0 });
  assert.equal(r.findings[0]!.detail, "3.1:1 measured");
});
