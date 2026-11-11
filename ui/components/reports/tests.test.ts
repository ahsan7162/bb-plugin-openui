import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTests } from "./tests";
import { parseXml } from "./xml";

test("vitest/jest JSON: statuses, ANSI stripped, line from location or stack, failed file without tests", () => {
  const report = {
    numTotalTests: 3,
    testResults: [
      {
        name: "/home/me/app/src/a.test.ts",
        status: "failed",
        assertionResults: [
          { ancestorTitles: ["sum"], title: "adds", fullName: "sum adds", status: "passed", duration: 2, failureMessages: [] },
          {
            ancestorTitles: ["sum"],
            title: "carries",
            fullName: "sum carries",
            status: "failed",
            failureMessages: ["\u001b[31mAssertionError: expected 3 to be 4\u001b[39m\n    at /home/me/app/src/a.test.ts:14:9"],
          },
          { ancestorTitles: [], title: "later", status: "todo", failureMessages: [] },
        ],
      },
      { name: "/home/me/app/src/b.test.ts", status: "failed", message: "SyntaxError: Unexpected token", assertionResults: [] },
    ],
  };
  const run = parseTests(JSON.stringify(report));
  assert.deepEqual(run.counts, { passed: 1, failed: 2, skipped: 1 });
  const failed = run.cases.find((c) => c.name === "sum carries")!;
  assert.equal(failed.message, "AssertionError: expected 3 to be 4\n    at /home/me/app/src/a.test.ts:14:9");
  assert.equal(failed.file, "a.test.ts");
  assert.equal(failed.line, 14);
  assert.equal(run.cases.find((c) => c.file === "b.test.ts")?.message, "SyntaxError: Unexpected token");
  assert.equal(run.cases.find((c) => c.name === "later")?.status, "skipped");
});

test("JUnit XML: nested suites, self-closing cases, CDATA, entities, error and skipped", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tests.test_api" file="tests/test_api.py">
    <testcase classname="tests.test_api" name="test_ok" time="0.012"/>
    <testcase classname="tests.test_api" name="test_cmp" line="21">
      <failure message="assert 1 &lt; 0"><![CDATA[def test_cmp():
>       assert 1 < 0]]></failure>
    </testcase>
    <testcase classname="tests.test_api" name="test_db"><error message="ConnectionError &amp; timeout"/></testcase>
    <testcase classname="tests.test_api" name="test_slow"><skipped message="needs &quot;db&quot;"/></testcase>
  </testsuite>
  <testsuite name="vitest"><testcase classname="src/x.test.ts" name="x &gt; y" time="1"/></testsuite>
</testsuites>`;
  const run = parseTests(xml);
  assert.deepEqual(run.counts, { passed: 2, failed: 2, skipped: 1 });
  const cmp = run.cases.find((c) => c.name === "test_cmp")!;
  // The body already holds the headline, so it is not repeated.
  assert.equal(cmp.message, "def test_cmp():\n>       assert 1 < 0");
  assert.equal(cmp.line, 21);
  assert.equal(cmp.file, "tests/test_api.py");
  assert.equal(run.cases.find((c) => c.name === "test_db")?.message, "ConnectionError & timeout");
  assert.equal(run.cases.find((c) => c.name === "test_slow")?.message, 'needs "db"');
  const vitest = run.cases.find((c) => c.name === "x > y")!;
  assert.equal(vitest.file, "src/x.test.ts");
  assert.equal(vitest.ms, 1000);
});

test("inline list and unknown input", () => {
  const run = parseTests([{ name: "renders", status: "passed" }, { name: "saves", status: "failed", message: "timeout", file: "a.ts", line: 3 }, { status: "passed" }]);
  assert.equal(run.cases.length, 2);
  assert.equal(run.counts.failed, 1);
  assert.throws(() => parseTests('{"hello": 1}'), /vitest or jest/);
});

test("xml reader tolerates a stray close tag and numeric entities", () => {
  const root = parseXml("<a><b x='1'>&#x41;&#66;</c></b></a>");
  assert.equal(root.children[0]!.children[0]!.text, "AB");
  assert.equal(root.children[0]!.children[0]!.attrs.x, "1");
});
