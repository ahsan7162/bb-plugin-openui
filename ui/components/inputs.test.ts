import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, codeFence, moveItem, quizScore, removeAt, replaceAt, stepTo } from "./inputs/logic";

test("stepTo rounds to the step and clamps", () => {
  assert.equal(stepTo(0.1, 0.2, 0.1), 0.3);
  assert.equal(stepTo(19, 5, 1, 1, 20), 20);
  assert.equal(stepTo(1, -1, 1, 1, 20), 1);
  assert.equal(stepTo(2.5, 0.25, 0.25), 2.75);
});

test("list edits keep edges and order", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(removeAt(["a", "b", "c"], 1), ["a", "c"]);
  assert.deepEqual(replaceAt(["a", "b"], 0, "z"), ["z", "b"]);
});

test("clock formats minutes and hours", () => {
  assert.equal(clock(83_000), "1:23");
  assert.equal(clock(3_723_000), "1:02:03");
  assert.equal(clock(200, true), "0:01");
  assert.equal(clock(-5), "0:00");
});

test("quizScore counts matching picks only", () => {
  assert.equal(quizScore([1, 0, null], [1, 1, 2]), 1);
  assert.equal(quizScore([], [0]), 0);
});

test("codeFence outgrows backticks and cleans the language", () => {
  assert.equal(codeFence("git log", "bash"), "```bash\ngit log\n```");
  assert.match(codeFence("a ```` b"), /^`````\n/);
  assert.equal(codeFence("x", "js\n<b>"), "```jsb\nx\n```");
});
