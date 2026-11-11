import { test } from "node:test";
import assert from "node:assert/strict";
import { band, bin, boxStats, buildTree, calendarLayout, layoutTreemap, level, parseDays, quantile, squarify, ticks } from "./numbers/math";

test("ticks give 3 to 5 gridlines on round values covering the range", () => {
  for (const [min, max] of [[0, 7], [0, 348], [61, 236], [-3, 12], [0, 0.07], [1.8, 19.7]] as const) {
    const t = ticks(min, max);
    assert.ok(t.lo <= min && t.hi >= max, `${min}..${max} covered`);
    assert.ok(t.values.length >= 3 && t.values.length <= 5, `${min}..${max}: ${t.values}`);
  }
  assert.deepEqual(ticks(0, 7, 4, true).values, [0, 2, 4, 6, 8]);
});

test("bin keeps every value and uses round edges", () => {
  const values = [61, 68, 72, 75, 77, 79, 81, 83, 84, 86, 88, 89, 91, 93, 94, 96, 98, 101, 104, 107, 111, 115, 120, 126, 133, 141, 152, 168, 190, 236];
  const { edges, counts } = bin(values);
  assert.equal(counts.reduce((a, b) => a + b, 0), values.length);
  assert.equal(edges.length, counts.length + 1);
  assert.ok(edges[0]! <= 61 && edges[edges.length - 1]! >= 236);
  const step = edges[1]! - edges[0]!;
  assert.equal(step, 25, "Sturges gives 6 bins of about 29; the nearest round width is 25");
  assert.ok(edges.every((e) => Number.isInteger(e / step)), `round edges ${edges}`);
  const fixed = bin([0, 1, 2, 3, 4, 5, 6, 7, 8, 10], 5);
  assert.deepEqual(fixed.edges, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(fixed.counts, [2, 2, 2, 2, 2]);
  assert.deepEqual(bin([3, 3, 3]).counts, [3]);
  assert.deepEqual(bin([]).counts, []);
});

test("quartiles interpolate and outliers fall outside 1.5 IQR", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  const s = boxStats([1.8, 1.9, 1.9, 2.0, 2.0, 2.1, 2.1, 2.2, 2.2, 2.3, 2.4, 3.9])!;
  assert.equal(s.median, 2.1);
  assert.ok(Math.abs(s.q1 - 1.975) < 1e-9 && Math.abs(s.q3 - 2.225) < 1e-9);
  assert.deepEqual(s.outliers, [3.9]);
  assert.equal(s.high, 2.4);
  assert.equal(s.low, 1.8);
  assert.equal(boxStats([]), null);
});

test("squarify fills the rectangle with areas in proportion", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((size) => ({ size }));
  const rects = squarify(items, { x: 0, y: 0, w: 600, h: 400 });
  assert.equal(rects.length, items.length);
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 240_000) < 1e-6);
  for (const r of rects) {
    assert.ok(Math.abs(r.w * r.h - (r.item.size / 24) * 240_000) < 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-9 && r.y + r.h <= 400 + 1e-9);
    assert.ok(Math.max(r.w / r.h, r.h / r.w) < 3, "close to square");
  }
  assert.deepEqual(squarify([{ size: 0 }], { x: 0, y: 0, w: 10, h: 10 }), []);
});

test("paths nest into a tree and the layout keeps children inside parents", () => {
  const tree = buildTree([
    { path: "src/core/a.ts", size: 50 },
    { path: "src/core/b.ts", size: 30 },
    { path: "src/ui/c.tsx", size: 20 },
    { path: "src/index.ts", size: 0 },
  ]);
  assert.equal(tree.path, "src", "single folder root collapsed");
  assert.equal(tree.size, 100);
  assert.deepEqual(tree.children.map((c) => [c.name, c.size]), [["core", 80], ["ui", 20]]);
  const tiles = layoutTreemap(tree, 600, 300);
  const leaves = tiles.filter((t) => t.leaf);
  assert.deepEqual(leaves.map((t) => t.node.name).sort(), ["a.ts", "b.ts", "c.tsx"]);
  const core = tiles.find((t) => t.node.name === "core")!;
  for (const leaf of leaves.filter((t) => t.node.path.startsWith("src/core/"))) {
    assert.ok(leaf.x >= core.x && leaf.y >= core.y && leaf.x + leaf.w <= core.x + core.w + 1e-9 && leaf.y + leaf.h <= core.y + core.h + 1e-9);
    assert.equal(leaf.branch, core.branch);
  }
});

test("calendar puts weeks in columns, Monday first, with month labels", () => {
  const days = parseDays({ "2026-08-03": 4, "2026-08-05": 1, "2026-09-01": 2, nope: 3 });
  assert.equal(days.size, 3);
  assert.equal(parseDays([{ date: "2026-08-03", value: 2 }, { date: "bad", value: 1 }]).size, 1);
  const { weeks, cells, months } = calendarLayout(days);
  assert.equal(cells[0]!.date, "2026-08-03");
  assert.equal(cells[0]!.row, 0, "2026-08-03 is a Monday");
  assert.equal(cells.length, 30);
  assert.equal(weeks, 5);
  const sep1 = cells.find((c) => c.date === "2026-09-01")!;
  assert.deepEqual([sep1.col, sep1.row, sep1.value], [4, 1, 2]);
  assert.deepEqual(months.map((m) => m.col), [0, 4]);
  const long = calendarLayout(parseDays({ "2024-01-01": 1, "2026-08-03": 1 }), 53);
  assert.equal(long.weeks, 53);
});

test("levels split values into five steps", () => {
  assert.deepEqual([0, 1, 25, 26, 100].map((v) => level(v, 100)), [0, 1, 1, 2, 4]);
  assert.deepEqual([0, 10, 20, 30].map((v) => band(v, 0, 30)), [0, 1, 3, 4]);
});
