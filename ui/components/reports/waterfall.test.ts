import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWaterfall } from "./waterfall";

test("inline spans keep their unit, drop partial rows, clamp depth", () => {
  const t = parseWaterfall([{ name: "request", start: 0, duration: 420 }, { name: "db", start: 40, duration: 300, depth: 9 }, { name: "half" }], "ms");
  assert.equal(t.spans.length, 2);
  assert.equal(t.spans[1]!.depth, 6);
  assert.equal(t.end, 420);
  assert.equal(t.unit, "ms");
});

test("HAR: starts relative to the first request, failed requests flagged", () => {
  const har = {
    log: {
      entries: [
        { startedDateTime: "2026-10-01T10:00:00.250Z", time: 80, request: { method: "GET", url: "https://cdn.example.com/app.js" }, response: { status: 200 } },
        { startedDateTime: "2026-10-01T10:00:00.000Z", time: 120.5, request: { method: "GET", url: "https://example.com/" }, response: { status: 200 } },
        { startedDateTime: "2026-10-01T10:00:00.400Z", time: 30, request: { method: "POST", url: "https://api.example.com/log" }, response: { status: 0 } },
      ],
    },
  };
  const t = parseWaterfall(JSON.stringify(har), "s");
  assert.equal(t.unit, "ms");
  assert.deepEqual(t.spans.map((s) => [s.name, s.start]), [["example.com", 0], ["cdn.example.com/app.js", 250], ["api.example.com/log", 400]]);
  assert.equal(t.spans[2]!.failed, true);
  assert.equal(t.spans[2]!.detail, "POST, no response");
  assert.equal(t.end, 430);
  assert.throws(() => parseWaterfall("{}"), /HAR/);
});
