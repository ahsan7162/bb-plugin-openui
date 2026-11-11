// Pure layout and statistics for the Numbers and charts group. No React, no CSS: tested under plain Node.

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** The finite numbers of a possibly partial (streaming) list. */
export const finite = (list: unknown): number[] => (Array.isArray(list) ? list.filter(isNum) : []);
const tidy = (n: number) => Number(n.toPrecision(12));

const NICE = [1, 2, 2.5, 5, 10];
/** The smallest 1/2/2.5/5 x 10^k step that splits `span` into at most `count` parts. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  return tidy((NICE.find((f) => f * power >= raw) ?? 10) * power);
}

/** The 1/2/2.5/5 x 10^k step closest to `raw` (above or below), for bin widths. */
export function nearStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const best = NICE.reduce((b, f) => (Math.abs(Math.log((f * power) / raw)) < Math.abs(Math.log((b * power) / raw)) ? f : b));
  return tidy(best * power);
}

/** Axis from lo to hi with 3 to 5 gridlines on round values that cover [min, max]. */
export function ticks(min: number, max: number, count = 4, integer = false): { lo: number; hi: number; values: number[] } {
  if (min === max) max = min + (integer ? 1 : Math.abs(min) || 1);
  let step = niceStep(max - min, count);
  if (integer) step = Math.max(1, Math.ceil(step));
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  // floor/ceil can add a part at each end; widen the step until the axis has at most `count` parts.
  while ((hi - lo) / step > count + 1e-9) {
    step = niceStep(step * 1.0001, 1);
    lo = Math.floor(min / step) * step;
    hi = Math.ceil(max / step) * step;
  }
  const values: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(tidy(v));
  return { lo: tidy(lo), hi: tidy(hi), values };
}

/** Histogram bins: `bins` equal parts of the range if given, else Sturges' count on round edges. */
export function bin(values: number[], bins?: number): { edges: number[]; counts: number[] } {
  if (values.length === 0) return { edges: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { edges: [min - 0.5, min + 0.5], counts: [values.length] };
  let lo: number;
  let step: number;
  let k: number;
  if (bins !== undefined && bins >= 1) {
    k = Math.round(bins);
    lo = min;
    step = (max - min) / k;
  } else {
    const target = Math.min(20, Math.max(5, Math.ceil(Math.log2(values.length)) + 1));
    step = nearStep((max - min) / target);
    lo = Math.floor(min / step) * step;
    // A max that sits on the last edge joins the bin below it (the clamp in the loop).
    k = Math.max(1, Math.ceil(tidy((max - lo) / step)));
  }
  const counts = new Array<number>(k).fill(0);
  for (const v of values) counts[Math.min(k - 1, Math.floor(tidy((v - lo) / step)))]! += 1;
  return { edges: Array.from({ length: k + 1 }, (_, i) => tidy(lo + i * step)), counts };
}

/** Quantile of a sorted list by linear interpolation (R type 7, what spreadsheets use). */
export function quantile(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const i = Math.floor(h);
  const a = sorted[i]!;
  const b = sorted[Math.min(i + 1, sorted.length - 1)]!;
  return a + (h - i) * (b - a);
}

export interface BoxStats {
  n: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  /** Whisker ends: the furthest values within 1.5 IQR of the box. */
  low: number;
  high: number;
  outliers: number[];
}

export function boxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const reach = 1.5 * (q3 - q1);
  const inside = sorted.filter((v) => v >= q1 - reach && v <= q3 + reach);
  return {
    n: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    low: inside[0] ?? q1,
    high: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < q1 - reach || v > q3 + reach),
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap (Bruls, Huizing, van Wijk): rectangles with areas proportional to `size`, close to square. */
export function squarify<T extends { size: number }>(items: T[], rect: Rect): (Rect & { item: T })[] {
  const kept = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size);
  const total = kept.reduce((s, i) => s + i.size, 0);
  const out: (Rect & { item: T })[] = [];
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const free = { ...rect };
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    return Math.max(...row.map((r) => Math.max((side * side * r) / (s * s), (s * s) / (side * side * r))));
  };
  const place = (row: T[]) => {
    const areas = row.map((i) => i.size * scale);
    const s = areas.reduce((a, b) => a + b, 0);
    const vertical = free.w >= free.h; // lay the row down the short side
    const thick = vertical ? s / free.h : s / free.w;
    let at = vertical ? free.y : free.x;
    row.forEach((item, i) => {
      const len = areas[i]! / thick;
      out.push(vertical ? { x: free.x, y: at, w: thick, h: len, item } : { x: at, y: free.y, w: len, h: thick, item });
      at += len;
    });
    if (vertical) {
      free.x += thick;
      free.w -= thick;
    } else {
      free.y += thick;
      free.h -= thick;
    }
  };
  let row: T[] = [];
  for (const item of kept) {
    const side = Math.min(free.w, free.h);
    const areas = row.map((i) => i.size * scale);
    if (row.length === 0 || worst([...areas, item.size * scale], side) <= worst(areas, side)) row.push(item);
    else {
      place(row);
      row = [item];
    }
  }
  if (row.length > 0) place(row);
  return out;
}

export interface TreeNode {
  name: string;
  path: string;
  size: number;
  children: TreeNode[];
}

/** Nests `a/b/c` paths into a tree with summed sizes; a root with one folder child is collapsed into it. */
export function buildTree(items: { path: string; size: number }[]): TreeNode {
  const root: TreeNode = { name: "", path: "", size: 0, children: [] };
  for (const { path, size } of items) {
    if (!(size > 0) || typeof path !== "string") continue;
    const parts = path.split("/").filter(Boolean);
    let node = root;
    node.size += size;
    parts.forEach((name, i) => {
      const at = parts.slice(0, i + 1).join("/");
      let next = node.children.find((c) => c.name === name);
      if (!next) node.children.push((next = { name, path: at, size: 0, children: [] }));
      next.size += size;
      node = next;
    });
  }
  let top = root;
  while (top.children.length === 1 && top.children[0]!.children.length > 0) top = top.children[0]!;
  return top;
}

export interface Tile extends Rect {
  node: TreeNode;
  depth: number;
  /** Index of the top-level branch the tile belongs to, for its colour. */
  branch: number;
  leaf: boolean;
  /** Group tiles: whether a header strip was reserved for the name. */
  header: boolean;
}

/** Nested squarified layout: every folder's children laid out inside it, under a header strip when there is room. */
export function layoutTreemap(root: TreeNode, w: number, h: number, { header = 18, pad = 2 } = {}): Tile[] {
  const tiles: Tile[] = [];
  const walk = (node: TreeNode, rect: Rect, depth: number, branch: number | null) => {
    // A folder that is also a file of its own size keeps that share as a leaf.
    const own = node.size - node.children.reduce((s, c) => s + c.size, 0);
    const kids = own > 1e-9 && node !== root ? [...node.children, { name: node.name, path: node.path, size: own, children: [] }] : node.children;
    squarify(kids, rect).forEach((placed, i) => {
      const kid = placed.item;
      const leaf = kid.children.length === 0;
      const room = !leaf && placed.h >= header * 2.5 && placed.w >= 56;
      const at = branch ?? i;
      tiles.push({ x: placed.x, y: placed.y, w: placed.w, h: placed.h, node: kid, depth, branch: at, leaf, header: room });
      if (!leaf) {
        const top = room ? header : pad;
        walk(kid, { x: placed.x + pad, y: placed.y + top, w: placed.w - pad * 2, h: placed.h - top - pad }, depth + 1, at);
      }
    });
  };
  walk(root, { x: 0, y: 0, w, h }, 0, null);
  return tiles;
}

/** Daily values from `{"yyyy-mm-dd": n}` or `[{date, value}]`, malformed entries dropped. */
export function parseDays(days: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const add = (date: unknown, value: unknown) => {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && isNum(value)) map.set(date, (map.get(date) ?? 0) + value);
  };
  if (Array.isArray(days)) for (const d of days) add(d?.date, d?.value);
  else if (days && typeof days === "object") for (const [k, v] of Object.entries(days)) add(k, v);
  return map;
}

const DAY = 86_400_000;
const toTime = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export interface CalendarCell {
  date: string;
  value: number;
  col: number;
  /** 0 = Monday. */
  row: number;
}

/** Weeks as columns (Monday first), from the first date to the last, at most `maxWeeks` ending at the last date. */
export function calendarLayout(map: Map<string, number>, maxWeeks = 53): { weeks: number; cells: CalendarCell[]; months: { col: number; time: number }[] } {
  const dates = [...map.keys()].sort();
  if (dates.length === 0) return { weeks: 0, cells: [], months: [] };
  const end = toTime(dates[dates.length - 1]!);
  const endRow = (new Date(end).getUTCDay() + 6) % 7;
  const first = Math.max(toTime(dates[0]!), end - (maxWeeks * 7 - 1 - (6 - endRow)) * DAY);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY;
  const cells: CalendarCell[] = [];
  const months: { col: number; time: number }[] = [];
  for (let t = first; t <= end; t += DAY) {
    const day = new Date(t);
    const col = Math.floor((t - start) / DAY / 7);
    if (t === first || day.getUTCDate() === 1) {
      // A month that starts within two columns of the previous label takes its place.
      if (months.length > 0 && col - months[months.length - 1]!.col < 3) months.pop();
      months.push({ col, time: t });
    }
    const date = toDate(t);
    cells.push({ date, value: map.get(date) ?? 0, col, row: (day.getUTCDay() + 6) % 7 });
  }
  return { weeks: cells[cells.length - 1]!.col + 1, cells, months };
}

/** One of five colour levels: 0 for nothing, 1 to 4 by share of the maximum. */
export const level = (value: number, max: number) => (value <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((value / max) * 4))));

/** One of five levels across [min, max], for matrices where the lowest value still counts. */
export const band = (value: number, min: number, max: number) => (max <= min ? 2 : Math.min(4, Math.floor(((value - min) / (max - min)) * 5)));

/** SVG path of a circular arc over the top, from `from` to `to` as fractions of a half turn starting at the left. */
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (f: number) => {
    const a = Math.PI * (1 - f);
    return `${tidy(cx + r * Math.cos(a))} ${tidy(cy - r * Math.sin(a))}`;
  };
  return `M ${point(from)} A ${r} ${r} 0 0 1 ${point(to)}`;
}
