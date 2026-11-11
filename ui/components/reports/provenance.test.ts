import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProvenance, sameFact } from "./provenance";

test("short hash matches its full hash, case-insensitive values", () => {
  assert.equal(sameFact("1a68a02", "1a68a022fefb4c26ded1dbc0a1aa99d06ab79f87"), true);
  assert.equal(sameFact("Main", "main"), true);
  assert.equal(sameFact("1a68a02", "9f00b12"), false);
});

test("flags facts against expected and the previous stage, once per carried value", () => {
  const r = parseProvenance(
    [
      { name: "Checkout", status: "done", facts: { branch: "main", sha: "1a68a022fefb4c26ded1dbc0a1aa99d06ab79f87" } },
      { name: "Build", status: "done", facts: { branch: "main", sha: "1a68a02", build: 2811 } },
      { name: "Install", status: "done", facts: { build: "2810", device: "Test iPhone" } },
      { name: "Live" },
    ],
    { branch: "feat/399", device: "Test iPhone" },
  );
  assert.equal(r.stages.length, 4);
  assert.equal(r.stages[3]!.status, "pending");
  assert.equal(r.stages[0]!.facts[0]!.expected, "feat/399");
  assert.equal(r.stages[1]!.facts[0]!.expected, "feat/399"); // still shown on the stage
  assert.equal(r.stages[1]!.facts[1]!.changed, undefined); // short sha is the same commit
  assert.deepEqual(r.stages[2]!.facts[0]!.changed, { stage: "Build", value: "2811" });
  assert.deepEqual(r.drift.map((d) => `${d.stage}:${d.fact.key}`), ["Checkout:branch", "Install:build"]);
  assert.deepEqual(parseProvenance(undefined).stages, []);
});
