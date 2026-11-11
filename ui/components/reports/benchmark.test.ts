import { test } from "node:test";
import assert from "node:assert/strict";
import { changeWords, compare, parseBenchmark } from "./benchmark";

test("before/after rows: direction, words, zero baseline, noise", () => {
  const r = parseBenchmark([
    { name: "cold start", before: 820, after: 610 },
    { name: "throughput", before: 1200, after: 1100, better: "higher" },
    { name: "bundle", before: 0, after: 12 },
    { name: "parse", before: 100, after: 100.5 },
    { name: "partial" },
  ]);
  assert.equal(r.kind, "compare");
  if (r.kind !== "compare") return;
  assert.deepEqual(r.rows.map((x) => x.verdict), ["better", "worse", "new", "same"]);
  assert.equal(changeWords(r.rows[0]!, "ms"), "26% faster");
  assert.equal(changeWords(r.rows[1]!, "req/s"), "8.3% lower");
  assert.equal(changeWords(compare("size", 100, 120, "lower"), "KB"), "20% higher");
  assert.equal(changeWords(r.rows[2]!), "new, was zero");
  assert.equal(changeWords(r.rows[3]!), "no change");
});

test("hyperfine: ranked by mean, ratio to fastest, failed exit codes", () => {
  const hf = {
    results: [
      { command: "node -e 0", mean: 0.036, stddev: 0.004, exit_codes: [0, 0] },
      { command: "bun -e 0", mean: 0.009, stddev: 0.001, exit_codes: [0, 1] },
    ],
  };
  const r = parseBenchmark(JSON.stringify(hf));
  assert.equal(r.kind, "ranked");
  if (r.kind !== "ranked") return;
  assert.deepEqual(r.runs.map((x) => x.name), ["bun -e 0", "node -e 0"]);
  assert.equal(r.runs[1]!.ratio, 4);
  assert.equal(r.runs[0]!.failed, true);
  assert.throws(() => parseBenchmark("{}"), /hyperfine/);
});
