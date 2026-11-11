import { test } from "node:test";
import assert from "node:assert/strict";
import { dayOf, humanize, monthGrid, monthOf, ordered, pert, rank, shiftMonth, totals, weightedScore, Z90 } from "./planning/logic";

test("dates parse as UTC day numbers", () => {
  assert.equal(dayOf("1970-01-02"), 1);
  assert.equal(dayOf("2026-11-09")! - dayOf("2026-10-31")!, 9);
  assert.equal(dayOf("soon"), null);
  assert.equal(dayOf(undefined), null);
});

test("months parse, shift across years and grid Monday first", () => {
  assert.deepEqual(monthOf("2026-11"), { year: 2026, month: 10 });
  assert.equal(monthOf("2026-13"), null);
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  // November 2026 starts on a Sunday: six blanks, then 30 days, padded to whole weeks.
  const grid = monthGrid({ year: 2026, month: 10 });
  assert.equal(grid[0]!.filter((d) => d === null).length, 6);
  assert.equal(grid[0]![6], dayOf("2026-11-01"));
  assert.equal(grid.flat().filter((d) => d !== null).length, 30);
  assert.ok(grid.every((w) => w.length === 7));
  assert.equal(monthGrid({ year: 2028, month: 1 }).flat().filter((d) => d !== null).length, 29);
});

test("PERT per task and P50/P90 of the total", () => {
  assert.deepEqual(pert(1, 7, 4), { mean: 4, sd: 1 });
  assert.equal(pert(2, 4).mean, 3); // no likely: midpoint
  assert.equal(pert(4, 2).mean, 3); // swapped bounds
  const t = totals([{ low: 1, high: 7, likely: 4 }, { low: 0, high: 6, likely: 3 }]);
  assert.equal(t.p50, 7);
  assert.ok(Math.abs(t.sd - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(t.p90 - (7 + Z90 * Math.SQRT2)) < 1e-12);
  assert.deepEqual(totals([]), { p50: 0, p90: 0, sd: 0 });
});

test("weighted scores and ranking follow the weights", () => {
  assert.equal(weightedScore([5, 5], [1, 1]), 1);
  assert.equal(weightedScore([5, 1], [3, 0]), 1);
  assert.equal(weightedScore([4], [1, 1]), 0.4); // missing score counts 0
  assert.equal(weightedScore([4, 4], [0, 0]), 0);
  const options = [{ scores: [5, 1] }, { scores: [1, 5] }];
  assert.deepEqual(rank(options, [3, 1]), [0, 1]);
  assert.deepEqual(rank(options, [1, 3]), [1, 0]);
  assert.deepEqual(rank(options, [1, 1]), [0, 1]); // tie keeps order
});

test("helpers", () => {
  assert.deepEqual(ordered(["b", "a", "b"]), ["b", "a"]);
  assert.equal(humanize("in_progress"), "In progress");
});
