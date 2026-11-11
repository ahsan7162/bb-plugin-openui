import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoverage } from "./coverage";

test("lcov: per-file metrics, DA fallback, totals summed, worst first, no statements", () => {
  const lcov = `TN:
SF:/repo/src/good.ts
FNF:2
FNH:2
DA:1,1
DA:2,1
LF:2
LH:2
BRF:0
BRH:0
end_of_record
TN:
SF:/repo/src/bad.ts
DA:1,0
DA:2,3
DA:3,0
DA:4,1
BRF:4
BRH:1
end_of_record
`;
  const r = parseCoverage(lcov);
  assert.deepEqual(r.files.map((f) => f.file), ["bad.ts", "good.ts"]);
  assert.equal(r.files[0]!.metrics.lines!.pct, 50);
  assert.equal(r.files[0]!.metrics.branches!.pct, 25);
  assert.equal(r.files[1]!.metrics.branches, undefined); // BRF 0: not measured, not 0%
  assert.deepEqual(r.totals.lines, { pct: (4 / 6) * 100, covered: 4, total: 6 });
  assert.equal(r.totals.statements, undefined);
});

test("coverage-summary.json: total taken from the file", () => {
  const summary = {
    total: { lines: { total: 100, covered: 90, pct: 90 }, statements: { total: 120, covered: 100, pct: 83.3 }, functions: { total: 10, covered: 9 }, branches: { total: 40, covered: 30 } },
    "/w/a.ts": { lines: { total: 50, covered: 49 }, statements: { total: 60, covered: 58 }, functions: { total: 5, covered: 5 }, branches: { total: 20, covered: 18 } },
    "/w/b.ts": { lines: { total: 50, covered: 41 }, statements: { total: 60, covered: 42 }, functions: { total: 5, covered: 4 }, branches: { total: 20, covered: 12 } },
    "/w/empty.ts": { lines: { total: 0, covered: 0, pct: 100 } },
  };
  const r = parseCoverage(JSON.stringify(summary));
  assert.equal(r.totals.lines!.pct, 90);
  assert.deepEqual(r.files.map((f) => f.file), ["b.ts", "a.ts"]);
});

test("inline percentages average into totals; bad input throws", () => {
  const r = parseCoverage([{ file: "src/a.ts", lines: 80, branches: 60 }, { file: "src/b.ts", lines: 100 }]);
  assert.equal(r.totals.lines!.pct, 90);
  assert.equal(r.totals.branches!.pct, 60);
  assert.equal(r.files[0]!.file, "a.ts");
  assert.throws(() => parseCoverage("not coverage"), /lcov/);
});
