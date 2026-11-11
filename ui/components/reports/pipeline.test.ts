import { test } from "node:test";
import assert from "node:assert/strict";
import { overall, parsePipeline, runStatus } from "./pipeline";

test("gh run view JSON: statuses, durations, zero times ignored, running job", () => {
  const run = {
    status: "completed",
    conclusion: "failure",
    displayTitle: "fix: queue rejections",
    workflowName: "CI",
    headBranch: "fix/queue",
    headSha: "05edab7dc80d0bf679f3e769ca0b14b46b8cff47",
    url: "https://github.com/o/r/actions/runs/1",
    createdAt: "2026-10-09T20:19:08Z",
    updatedAt: "2026-10-09T20:24:08Z",
    jobs: [
      {
        name: "lint",
        status: "completed",
        conclusion: "success",
        startedAt: "2026-10-09T20:20:00Z",
        completedAt: "2026-10-09T20:21:12Z",
        steps: [
          { name: "Checkout", status: "completed", conclusion: "success", startedAt: "2026-10-09T20:20:00Z", completedAt: "2026-10-09T20:20:02Z" },
          { name: "Post", status: "completed", conclusion: "skipped", startedAt: "0001-01-01T00:00:00Z", completedAt: "0001-01-01T00:00:00Z" },
        ],
      },
      { name: "test", status: "completed", conclusion: "timed_out", startedAt: "2026-10-09T20:20:00Z", completedAt: "2026-10-09T20:24:00Z", steps: [] },
      { name: "deploy", status: "in_progress", startedAt: "2026-10-09T20:24:00Z", steps: [] },
    ],
  };
  const r = parsePipeline(JSON.stringify(run));
  assert.equal(r.status, "failure");
  assert.equal(r.time, "5m 0s");
  assert.equal(r.workflow, "CI");
  assert.deepEqual(r.jobs.map((j) => j.status), ["success", "failure", "running"]);
  assert.equal(r.jobs[0]!.time, "1m 12s");
  assert.equal(r.jobs[0]!.steps[0]!.time, "2.0 s");
  assert.equal(r.jobs[0]!.steps[1]!.time, undefined);
  assert.equal(r.jobs[2]!.time, undefined);
});

test("inline stages: durations in seconds or text, overall status", () => {
  const r = parsePipeline([
    { name: "Build", status: "passed", duration: 72 },
    { name: "Test", jobs: [{ name: "unit", status: "passed", duration: "3m 2s" }, { name: "e2e", status: "running" }] },
    { name: "Deploy", status: "queued" },
  ]);
  assert.equal(r.jobs[0]!.time, "1m 12s");
  assert.equal(r.jobs[1]!.status, "running");
  assert.equal(r.jobs[1]!.steps[0]!.time, "3m 2s");
  assert.equal(r.status, "running");
  assert.equal(overall([]), "skipped");
  assert.equal(runStatus("completed", "cancelled"), "cancelled");
  assert.throws(() => parsePipeline('{"x": 1}'), /gh run view/);
});
