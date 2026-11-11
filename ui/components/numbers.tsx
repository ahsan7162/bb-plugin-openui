// Numbers and charts: levels, small trends, shares, distributions, matrices and layouts of facts.
// Inline SVG or plain boxes drawn for the data; marks draw once when the reply stops streaming.
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { clamp, cx, fmt, TONES, useStreaming, type Tone } from "./kit";
import type { ExtraGroup } from "./types";
import {
  arc,
  band,
  bin,
  boxStats,
  buildTree,
  calendarLayout,
  finite,
  isNum,
  layoutTreemap,
  level,
  parseDays,
  ticks,
} from "./numbers/math";

const tone = z.enum(Object.keys(TONES) as [Tone, ...Tone[]]).optional();
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const pct = (share: number) => `${fmt(share * 100, { decimals: share > 0 && share < 0.1 ? 1 : 0 })}%`;
const fillOf = (t: Tone | undefined, fallback: Tone = "accent") => ({ "--bbui-numbers-fill": TONES[t ?? fallback] }) as React.CSSProperties;

/** Root of every chart: marks wait while streaming and draw once after (see numbers.css). */
function Chart({ className, label, children }: { className: string; label?: string; children: ReactNode }) {
  return (
    <figure className={cx("bbui bbui-numbers", className)}>
      {label ? <figcaption className="bbui-head">{label}</figcaption> : null}
      {children}
    </figure>
  );
}

/** Marks: absent while the reply streams, then mounted once so their CSS draw-in runs once. */
function Drawn({ children }: { children: ReactNode }) {
  return useStreaming() ? null : <>{children}</>;
}

/** Measured content width, so SVG draws in real pixels and text stays 11px; `fallback` before layout. */
function useWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

// Progress ------------------------------------------------------------------------------------

const Progress = defineComponent({
  name: "Progress",
  description: "A level toward a goal: slim bar plus the figure. max defaults to 100 (shown as a percent); other max shows \"3 of 12\".",
  props: z.object({ value: z.number(), max: z.number().optional(), label: z.string().optional(), tone }),
  component: ({ props }) => {
    const max = isNum(props.max) && props.max > 0 ? props.max : 100;
    const value = isNum(props.value) ? props.value : 0;
    const share = clamp(value / max, 0, 1);
    const figure = max === 100 ? pct(value / 100) : `${fmt(value)} of ${fmt(max)}`;
    const label = str(props.label);
    return (
      <Chart className="bbui-numbers-progress">
        <div className="bbui-numbers-progress-head">
          <span className="bbui-numbers-name">{label}</span>
          <span className="bbui-numbers-value">{figure}</span>
        </div>
        <div
          className="bbui-numbers-track"
          role="progressbar"
          aria-label={label || "Progress"}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={clamp(value, 0, max)}
          aria-valuetext={figure}
        >
          <Drawn>
            <span className="bbui-numbers-bar bbui-numbers-gx" style={{ ...fillOf(props.tone), width: `${share * 100}%` }} />
          </Drawn>
        </div>
      </Chart>
    );
  },
});

// Gauge ---------------------------------------------------------------------------------------

const Gauge = defineComponent({
  name: "Gauge",
  description: "A level against a limit as a half-circle meter with the figure, e.g. CPU against 100%. min defaults to 0, max to 100.",
  props: z.object({
    value: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    label: z.string().optional(),
    tone,
    unit: z.string().optional(),
  }),
  component: ({ props }) => {
    const min = isNum(props.min) ? props.min : 0;
    const max = isNum(props.max) && props.max > min ? props.max : min + 100;
    const value = isNum(props.value) ? props.value : min;
    const share = clamp((value - min) / (max - min), 0, 1);
    const unit = str(props.unit);
    const label = str(props.label);
    return (
      <Chart className="bbui-numbers-gauge">
        <div className="bbui-numbers-gauge-dial" role="img" aria-label={`${label || "Level"}: ${fmt(value, { unit })} on a scale of ${fmt(min)} to ${fmt(max, { unit })}`}>
          <svg viewBox="0 0 160 88" width="160" height="88" aria-hidden="true">
            <path className="bbui-numbers-gauge-track" d={arc(80, 80, 68, 0, 1)} />
            {share > 0 ? (
              <Drawn>
                <path className="bbui-numbers-gauge-arc bbui-numbers-fade" style={fillOf(props.tone)} d={arc(80, 80, 68, 0, share)} />
              </Drawn>
            ) : null}
          </svg>
          <span className="bbui-numbers-gauge-figure">
            <span className="bbui-figure">{fmt(value)}</span>
            {unit ? <span className="bbui-label"> {unit}</span> : null}
          </span>
        </div>
        <div className="bbui-numbers-gauge-ends bbui-numbers-tick" aria-hidden="true">
          <span>{fmt(min)}</span>
          <span>{fmt(max)}</span>
        </div>
        {label ? <span className="bbui-label bbui-numbers-gauge-label">{label}</span> : null}
      </Chart>
    );
  },
});

// Sparkline -----------------------------------------------------------------------------------

const Sparkline = defineComponent({
  name: "Sparkline",
  description: "Tiny inline trend of a list of numbers, no axes, last value marked and printed. Fits in a Table cell or beside a figure.",
  props: z.object({ values: z.array(z.number()), tone, label: z.string().optional() }),
  component: ({ props }) => {
    const id = `bbui-spark-${useId().replace(/[^\w-]/g, "")}`;
    const values = finite(props.values);
    const label = str(props.label);
    const W = 96;
    const H = 28;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (W - 6);
    const y = (v: number) => (hi === lo ? H / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (H - 6));
    const line = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const last = values[values.length - 1];
    const summary =
      values.length > 1 ? `${label || "Trend"}: ${values.length} values from ${fmt(values[0]!)} to ${fmt(last!)}, low ${fmt(lo)}, high ${fmt(hi)}` : `${label || "Trend"}: not enough values yet`;
    return (
      <span className="bbui bbui-numbers bbui-numbers-spark" style={fillOf(props.tone)}>
        {label ? <span className="bbui-label">{label}</span> : null}
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={summary}>
          {values.length > 1 ? (
            <Drawn><g className="bbui-numbers-fade">
              <defs>
                <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" className="bbui-numbers-spark-stop" />
                  <stop offset="1" className="bbui-numbers-spark-stop" style={{ stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <path d={`${line} L ${x(values.length - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`} style={{ fill: `url(#${id})` }} />
              <path className="bbui-numbers-line" d={line} />
              <circle className="bbui-numbers-dot" cx={x(values.length - 1)} cy={y(last!)} r={2.75} />
            </g></Drawn>
          ) : null}
        </svg>
        <span className="bbui-numbers-value">{isNum(last) ? fmt(last) : "-"}</span>
      </span>
    );
  },
});

// SegmentedBar --------------------------------------------------------------------------------

const SegmentedBarPart = defineComponent({
  name: "SegmentedBarPart",
  description: "One share of a SegmentedBar. tone only for real state; parts without one take the accent ramp in order.",
  props: z.object({ label: z.string(), value: z.number(), tone }),
  component: () => null,
});

type PartNode = { props?: { label?: unknown; value?: unknown; tone?: Tone } };

const SegmentedBar = defineComponent({
  name: "SegmentedBar",
  description: "Shares of one whole as one stacked bar with a legend of label, value and share. Five parts or fewer reads best.",
  props: z.object({ parts: z.array(SegmentedBarPart.ref), unit: z.string().optional() }),
  component: ({ props }) => {
    const unit = str(props.unit);
    const parts = list<PartNode>(props.parts)
      .map((p) => ({ label: str(p?.props?.label), value: p?.props?.value, tone: p?.props?.tone }))
      .filter((p): p is { label: string; value: number; tone: Tone | undefined } => isNum(p.value) && p.value > 0);
    const total = parts.reduce((s, p) => s + p.value, 0);
    let ramp = 0;
    const shown = parts.map((p) => ({ ...p, share: total > 0 ? p.value / total : 0, step: p.tone ? null : ramp++ }));
    const swatch = (p: (typeof shown)[number]) => (p.tone ? { className: "bbui-numbers-tone", style: fillOf(p.tone) } : { className: `bbui-numbers-s${Math.min(p.step!, 5)}` });
    return (
      <Chart className="bbui-numbers-segments">
        <div
          className="bbui-numbers-segbar"
          role="img"
          aria-label={`Shares of ${fmt(total, { unit })}: ${shown.map((p) => `${p.label} ${fmt(p.value, { unit })} (${pct(p.share)})`).join(", ")}`}
        >
          <Drawn>
            <span className="bbui-numbers-segfill bbui-numbers-gx">
              {shown.map((p, i) => {
                const s = swatch(p);
                return <span key={i} className={s.className} style={{ ...s.style, flexGrow: p.value }} />;
              })}
            </span>
          </Drawn>
        </div>
        <ul className="bbui-numbers-legend">
          {shown.map((p, i) => {
            const s = swatch(p);
            return (
              <li key={i}>
                <span className={cx("bbui-numbers-swatch", s.className)} style={s.style} aria-hidden="true" />
                <span className="bbui-numbers-name">{p.label}</span>
                <span className="bbui-numbers-value">{fmt(p.value, { unit })}</span>
                <span className="bbui-numbers-share">{pct(p.share)}</span>
              </li>
            );
          })}
        </ul>
      </Chart>
    );
  },
});

// CalendarHeatmap -----------------------------------------------------------------------------

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });
const dayOf = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

function Key({ low, high }: { low: string; high: string }) {
  return (
    <div className="bbui-numbers-key bbui-numbers-tick" aria-hidden="true">
      <span>{low}</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className={cx("bbui-numbers-swatch", `bbui-numbers-l${l}`)} />
      ))}
      <span>{high}</span>
    </div>
  );
}

const CalendarHeatmap = defineComponent({
  name: "CalendarHeatmap",
  description: 'Activity per day as weeks of squares, last 53 weeks at most. days: {"2026-08-03": 4, ...} or [{date, value}]; missing days count as 0.',
  props: z.object({
    days: z.union([z.record(z.string(), z.number()), z.array(z.object({ date: z.string(), value: z.number() }))]),
    label: z.string().optional(),
  }),
  component: ({ props }) => {
    const [ref, width] = useWidth();
    const { weeks, cells, months } = calendarLayout(parseDays(props.days));
    const max = Math.max(0, ...cells.map((c) => c.value));
    const gutter = 28;
    const pitch = clamp(Math.floor((width - gutter) / Math.max(1, weeks)), 11, 18);
    const size = pitch - 3;
    const top = 16;
    const busiest = cells.reduce<(typeof cells)[number] | undefined>((b, c) => (c.value > (b?.value ?? 0) ? c : b), undefined);
    const active = cells.filter((c) => c.value > 0).length;
    const total = cells.reduce((s, c) => s + c.value, 0);
    const label = str(props.label);
    const summary =
      cells.length === 0
        ? `${label || "Activity"}: no days yet`
        : `${label || "Activity"} per day from ${dayOf(cells[0]!.date)} to ${dayOf(cells[cells.length - 1]!.date)}: ${active} active days of ${cells.length}, ${fmt(total)} in total${busiest ? `, busiest ${dayOf(busiest.date)} with ${fmt(busiest.value)}` : ""}`;
    return (
      <Chart className="bbui-numbers-calendar" label={label}>
        <div ref={ref} className="bbui-numbers-scroll">
          <svg width={gutter + weeks * pitch} height={top + 7 * pitch} role="img" aria-label={summary}>
            {months.map((m) => (
              <text key={m.time} className="bbui-numbers-tick" x={gutter + m.col * pitch} y={11}>
                {monthName.format(m.time)}
              </text>
            ))}
            {[0, 2, 4].map((row) => (
              <text key={row} className="bbui-numbers-tick" x={0} y={top + row * pitch + size - 1}>
                {["Mon", "Wed", "Fri"][row / 2]}
              </text>
            ))}
            <Drawn><g className="bbui-numbers-fade">
              {cells.map((c) => (
                <rect key={c.date} className={`bbui-numbers-l${level(c.value, max)}`} x={gutter + c.col * pitch} y={top + c.row * pitch} width={size} height={size} rx={2}>
                  <title>{`${dayOf(c.date)}: ${fmt(c.value)}`}</title>
                </rect>
              ))}
            </g></Drawn>
          </svg>
        </div>
        <Key low="Less" high="More" />
      </Chart>
    );
  },
});

// Treemap -------------------------------------------------------------------------------------

const Treemap = defineComponent({
  name: "Treemap",
  description: 'Sizes as nested rectangles, e.g. bundle or disk usage. items: [{path: "src/ui/app.tsx", size: 3021}]; "/" in path nests. Labels show where they fit.',
  props: z.object({ items: z.array(z.object({ path: z.string(), size: z.number() })), unit: z.string().optional() }),
  component: ({ props }) => {
    const [ref, width] = useWidth();
    const unit = str(props.unit);
    const items = list<{ path?: unknown; size?: unknown }>(props.items).filter((i): i is { path: string; size: number } => typeof i?.path === "string" && isNum(i.size));
    const tree = buildTree(items);
    const height = Math.round(clamp(width * 0.56, 200, 360));
    const tiles = layoutTreemap(tree, width, height);
    const largest = [...items].sort((a, b) => b.size - a.size).slice(0, 3);
    const summary = `Treemap of ${items.length} items totalling ${fmt(tree.size, { unit })}${largest.length ? `; largest ${largest.map((i) => `${i.path} ${fmt(i.size, { unit })}`).join(", ")}` : ""}`;
    return (
      <Chart className="bbui-numbers-treemap">
        <div ref={ref} className="bbui-numbers-treemap-area" style={{ height }} role="img" aria-label={summary}>
          <Drawn>
          {tiles.map((t) => {
            const fits = t.leaf ? t.w >= 64 && t.h >= 34 : t.header;
            return (
              <div
                key={`${t.node.path}|${t.leaf}`}
                className={cx("bbui-numbers-tile bbui-numbers-fade", t.leaf ? `bbui-numbers-t${t.branch % 4}` : "bbui-numbers-group")}
                style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                title={`${t.node.path}: ${fmt(t.node.size, { unit })} (${pct(t.node.size / tree.size)})`}
              >
                {fits ? (
                  <span className="bbui-numbers-tile-text">
                    <span className="bbui-numbers-name">{t.node.name}</span> <span className="bbui-numbers-tick">{fmt(t.node.size, { unit, compact: true })}</span>
                  </span>
                ) : null}
              </div>
            );
          })}
          </Drawn>
        </div>
      </Chart>
    );
  },
});

// Histogram -----------------------------------------------------------------------------------

const Histogram = defineComponent({
  name: "Histogram",
  description: "Distribution of raw values (latencies, sizes, scores) as counts per bin. bins defaults to a round-edged count from the data.",
  props: z.object({ values: z.array(z.number()), bins: z.number().optional(), label: z.string().optional(), unit: z.string().optional() }),
  component: ({ props }) => {
    const [ref, width] = useWidth();
    const values = finite(props.values);
    const unit = str(props.unit);
    const label = str(props.label);
    const { edges, counts } = bin(values, isNum(props.bins) ? clamp(props.bins, 1, 60) : undefined);
    const axis = ticks(0, Math.max(1, ...counts), 4, true);
    const left = 32;
    const H = 168;
    const bottom = 20;
    const plotW = Math.max(40, width - left - 4);
    const plotH = H - bottom - 6;
    const bw = counts.length ? plotW / counts.length : 0;
    const y = (c: number) => 6 + plotH * (1 - c / axis.hi);
    const every = Math.max(1, Math.ceil(edges.length / Math.max(2, Math.floor(plotW / 56))));
    const peak = counts.indexOf(Math.max(...counts));
    const summary =
      values.length === 0
        ? `${label || "Histogram"}: no values yet`
        : `${label || "Histogram"}: ${values.length} values from ${fmt(Math.min(...values))} to ${fmt(Math.max(...values), { unit })} in ${counts.length} bins; most common ${fmt(edges[peak]!)} to ${fmt(edges[peak + 1]!, { unit })} with ${counts[peak]}`;
    return (
      <Chart className="bbui-numbers-histogram" label={label}>
        <div ref={ref}>
          <svg width={width} height={H} role="img" aria-label={summary}>
            {axis.values.map((v) => (
              <g key={v}>
                <line className="bbui-numbers-grid" x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} />
                <text className="bbui-numbers-tick" x={left - 6} y={y(v) + 4} textAnchor="end">
                  {fmt(v, { compact: true })}
                </text>
              </g>
            ))}
            <Drawn><g className="bbui-numbers-gy">
              {counts.map((c, i) =>
                c > 0 ? (
                  <path key={i} className="bbui-numbers-mark" d={barUp(left + i * bw + 0.5, y(c), Math.max(1, bw - 1), y(0) - y(c))}>
                    <title>{`${fmt(edges[i]!)} to ${fmt(edges[i + 1]!, { unit })}: ${c}`}</title>
                  </path>
                ) : null,
              )}
            </g></Drawn>
            {edges.map((e, i) =>
              i % every === 0 ? (
                <text key={i} className="bbui-numbers-tick" x={left + i * bw} y={H - 4} textAnchor={i === 0 ? "start" : i === edges.length - 1 ? "end" : "middle"}>
                  {fmt(e, { compact: true })}
                </text>
              ) : null,
            )}
          </svg>
        </div>
        {unit ? <span className="bbui-numbers-tick bbui-numbers-unit">Count per bin, values in {unit}</span> : null}
      </Chart>
    );
  },
});

/** A vertical bar rounded 2px at its top (the data end) only. */
function barUp(x: number, y: number, w: number, h: number) {
  const r = Math.min(2, w / 2, h);
  return `M ${x} ${y + h} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h} Z`;
}

// BoxPlot -------------------------------------------------------------------------------------

const BoxPlot = defineComponent({
  name: "BoxPlot",
  description: "Spread of several samples side by side: median, quartiles, whiskers at 1.5 IQR and outliers. groups: [{label, values: [raw numbers]}].",
  props: z.object({ groups: z.array(z.object({ label: z.string(), values: z.array(z.number()) })), unit: z.string().optional() }),
  component: ({ props }) => {
    const [ref, width] = useWidth();
    const unit = str(props.unit);
    const groups = list<{ label?: unknown; values?: unknown }>(props.groups)
      .map((g) => ({ label: str(g?.label), stats: boxStats(finite(g?.values)) }))
      .filter((g): g is { label: string; stats: NonNullable<typeof g.stats> } => g.stats !== null);
    const all = groups.flatMap((g) => [g.stats.min, g.stats.max]);
    const axis = ticks(Math.min(0, ...all), Math.max(...all, 1), 4);
    const pad = 12;
    const x = (v: number) => pad + ((v - axis.lo) / (axis.hi - axis.lo)) * (width - pad * 2);
    const summary = `Box plot of ${groups.length} groups${unit ? ` in ${unit}` : ""}: ${groups.map((g) => `${g.label} median ${fmt(g.stats.median)}, middle half ${fmt(g.stats.q1)} to ${fmt(g.stats.q3)}${g.stats.outliers.length ? `, ${g.stats.outliers.length} outliers` : ""}`).join("; ")}`;
    return (
      <Chart className="bbui-numbers-box">
        <div ref={ref} role="img" aria-label={summary}>
          {groups.map((g, i) => {
            const s = g.stats;
            return (
              <div key={i} className="bbui-numbers-box-row">
                <div className="bbui-numbers-progress-head">
                  <span className="bbui-numbers-name">{g.label}</span>
                  <span className="bbui-numbers-share">median {fmt(s.median, { unit })}</span>
                </div>
                <svg width={width} height={24} aria-hidden="true">
                  {axis.values.map((v) => (
                    <line key={v} className="bbui-numbers-grid" x1={x(v)} x2={x(v)} y1={0} y2={24} />
                  ))}
                  <Drawn><g className="bbui-numbers-fade">
                    <title>{`${g.label}: min ${fmt(s.min)}, q1 ${fmt(s.q1)}, median ${fmt(s.median)}, q3 ${fmt(s.q3)}, max ${fmt(s.max, { unit })}`}</title>
                    <line className="bbui-numbers-whisker" x1={x(s.low)} x2={x(s.q1)} y1={12} y2={12} />
                    <line className="bbui-numbers-whisker" x1={x(s.q3)} x2={x(s.high)} y1={12} y2={12} />
                    <line className="bbui-numbers-whisker" x1={x(s.low)} x2={x(s.low)} y1={7} y2={17} />
                    <line className="bbui-numbers-whisker" x1={x(s.high)} x2={x(s.high)} y1={7} y2={17} />
                    <rect className="bbui-numbers-box-body" x={x(s.q1)} y={4} width={Math.max(1, x(s.q3) - x(s.q1))} height={16} rx={2} />
                    <line className="bbui-numbers-median" x1={x(s.median)} x2={x(s.median)} y1={4} y2={20} />
                    {s.outliers.map((o, j) => (
                      <circle key={j} className="bbui-numbers-outlier" cx={x(o)} cy={12} r={3} />
                    ))}
                  </g></Drawn>
                </svg>
              </div>
            );
          })}
          <svg width={width} height={16} aria-hidden="true">
            {axis.values.map((v, i) => (
              <text key={v} className="bbui-numbers-tick" x={x(v)} y={12} textAnchor={i === 0 ? "start" : i === axis.values.length - 1 ? "end" : "middle"}>
                {fmt(v, { compact: true })}
              </text>
            ))}
          </svg>
        </div>
        {unit ? <span className="bbui-numbers-tick bbui-numbers-unit">Values in {unit}</span> : null}
      </Chart>
    );
  },
});

// Heatmap -------------------------------------------------------------------------------------

const Heatmap = defineComponent({
  name: "Heatmap",
  description: "A matrix of numbers as shaded cells, e.g. builds by weekday and hour. values: one list per row, one number per column; null for no data.",
  props: z.object({
    rows: z.array(z.string()),
    columns: z.array(z.string()),
    values: z.array(z.array(z.number().nullable())),
    unit: z.string().optional(),
  }),
  component: ({ props }) => {
    const rows = list<unknown>(props.rows).map(str);
    const columns = list<unknown>(props.columns).map(str);
    const unit = str(props.unit);
    const ready = !useStreaming();
    const matrix = rows.map((_, r) => columns.map((_, c) => list<unknown>(list<unknown>(props.values)[r])[c]));
    const all = matrix.flat().filter(isNum);
    const min = Math.min(...all);
    const max = Math.max(...all);
    let peak = { r: 0, c: 0 };
    matrix.forEach((row, r) => row.forEach((v, c) => isNum(v) && v === max && (peak = { r, c })));
    const summary = all.length
      ? `Heatmap of ${rows.length} rows by ${columns.length} columns, values ${fmt(min)} to ${fmt(max, { unit })}; highest ${rows[peak.r]} at ${columns[peak.c]}`
      : "Heatmap: no values yet";
    return (
      <Chart className="bbui-numbers-heatmap">
        <div className="bbui-numbers-scroll">
          <div className="bbui-numbers-matrix" style={{ gridTemplateColumns: `max-content repeat(${columns.length}, minmax(14px, 1fr))` }} role="img" aria-label={summary}>
            <span />
            {columns.map((c, i) => (
              <span key={i} className="bbui-numbers-tick bbui-numbers-col">
                {c}
              </span>
            ))}
            {matrix.map((row, r) => (
              <Fragment key={r}>
                <span className="bbui-numbers-tick bbui-numbers-rowname">{rows[r]}</span>
                {row.map((v, c) => (
                  <span
                    key={c}
                    className={cx("bbui-numbers-cell", !isNum(v) ? "bbui-numbers-none" : ready ? `bbui-numbers-fade bbui-numbers-l${band(v, min, max)}` : "bbui-numbers-l0")}
                    title={`${rows[r]}, ${columns[c]}: ${isNum(v) ? fmt(v, { unit }) : "no data"}`}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        {all.length ? <Key low={fmt(min)} high={fmt(max, { unit })} /> : null}
      </Chart>
    );
  },
});

// Funnel --------------------------------------------------------------------------------------

const Funnel = defineComponent({
  name: "Funnel",
  description: "Stages of a flow as shrinking bars with the conversion from the step before. stages: [{label, value}] in flow order.",
  props: z.object({ stages: z.array(z.object({ label: z.string(), value: z.number() })), unit: z.string().optional() }),
  component: ({ props }) => {
    const unit = str(props.unit);
    const stages = list<{ label?: unknown; value?: unknown }>(props.stages)
      .map((s) => ({ label: str(s?.label), value: s?.value }))
      .filter((s): s is { label: string; value: number } => isNum(s.value) && s.value >= 0);
    const top = Math.max(0, ...stages.map((s) => s.value));
    const first = stages[0]?.value ?? 0;
    const last = stages[stages.length - 1]?.value ?? 0;
    const step = (i: number) => (i > 0 && stages[i - 1]!.value > 0 ? stages[i]!.value / stages[i - 1]!.value : null);
    const summary = `Funnel of ${stages.length} stages: ${stages.map((s, i) => `${s.label} ${fmt(s.value, { unit })}${step(i) !== null ? ` (${pct(step(i)!)} of the step before)` : ""}`).join(", ")}`;
    return (
      <Chart className="bbui-numbers-funnel">
        <ol role="img" aria-label={summary}>
          {stages.map((s, i) => (
            <li key={i}>
              <div className="bbui-numbers-progress-head">
                <span className="bbui-numbers-name">{s.label}</span>
                <span>
                  <span className="bbui-numbers-value">{fmt(s.value, { unit })}</span>
                  {step(i) !== null ? <span className="bbui-numbers-share"> {pct(step(i)!)} of previous</span> : null}
                </span>
              </div>
              <div className="bbui-numbers-lane">
                <Drawn>
                  <span className="bbui-numbers-bar bbui-numbers-gx" style={{ ...fillOf("accent"), width: `${top > 0 ? (s.value / top) * 100 : 0}%` }} />
                </Drawn>
              </div>
            </li>
          ))}
        </ol>
        {stages.length > 1 && first > 0 ? <span className="bbui-numbers-tick">Overall {pct(last / first)} of the first stage</span> : null}
      </Chart>
    );
  },
});

// KeyValue ------------------------------------------------------------------------------------

const KeyValue = defineComponent({
  name: "KeyValue",
  description: 'Facts as a list of name and value, e.g. {Branch: "fix/upload", Author: "sam"} or [["Branch", "fix/upload"]]. Values may be components like Tag.',
  props: z.object({ pairs: z.union([z.record(z.string(), z.any()), z.array(z.array(z.any()))]) }),
  component: ({ props, renderNode }) => {
    const raw: unknown = props.pairs;
    const pairs = (Array.isArray(raw) ? raw.filter(Array.isArray).map((p) => [p[0], p[1]] as const) : raw && typeof raw === "object" ? Object.entries(raw) : []).filter(
      ([k]) => typeof k === "string" || isNum(k),
    );
    const show = (v: unknown): ReactNode => {
      if (v === null || v === undefined || v === "") return "-";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (isNum(v)) return fmt(v);
      if (typeof v === "object") return renderNode(v);
      return String(v);
    };
    return (
      <dl className="bbui bbui-numbers-facts">
        {pairs.map(([k, v], i) => (
          <div key={i} className="bbui-numbers-fact">
            <dt className="bbui-label">{String(k)}</dt>
            <dd>{show(v)}</dd>
          </div>
        ))}
      </dl>
    );
  },
});

// Grid ----------------------------------------------------------------------------------------

const Grid = defineComponent({
  name: "Grid",
  description: "Equal tiles side by side for comparable items (Gauges, small charts, short cards). columns defaults to 2; one column when narrow.",
  props: z.object({ children: z.array(z.any()), columns: z.number().optional() }),
  component: ({ props, renderNode }) => {
    const children = list<unknown>(props.children);
    const columns = Math.round(clamp(isNum(props.columns) ? props.columns : 2, 1, 4));
    return (
      <div className="bbui bbui-numbers-grid">
        <div className="bbui-numbers-tiles" style={{ "--bbui-numbers-cols": columns } as React.CSSProperties}>
          {children.map((child, i) => (
            <div key={i} className="bbui-numbers-tilecell">
              {renderNode(child)}
            </div>
          ))}
        </div>
      </div>
    );
  },
});

// Group ---------------------------------------------------------------------------------------

export const numbersGroup: ExtraGroup = {
  name: "Numbers and charts",
  notes: [
    "For bar, line, area, pie, radar and scatter charts, tables and single metrics use the built-ins; these cover levels, shares, distributions and matrices.",
    'Object arguments are written inline: Funnel([{label: "Visited", value: 1200}, {label: "Paid", value: 90}]).',
  ],
  components: [Progress, Gauge, Sparkline, SegmentedBar, SegmentedBarPart, CalendarHeatmap, Treemap, Histogram, BoxPlot, Heatmap, Funnel, KeyValue, Grid],
  examples: {
    Progress: `root = Stack([title, rows, tables])
title = TextContent("Database migration", "large-heavy")
rows = Progress(68, 100, "Rows copied")
tables = Progress(3, 12, "Tables verified", "good")`,
    Gauge: `root = Stack([title, grid])
title = TextContent("Server health, sample", "large-heavy")
grid = Grid([cpu, mem, disk], 3)
cpu = Gauge(72, 0, 100, "CPU", "accent", "%")
mem = Gauge(6.8, 0, 8, "Memory", "warn", "GB")
disk = Gauge(41, 0, 100, "Disk", "accent", "%")`,
    Sparkline: `root = Stack([title, table])
title = TextContent("Endpoint latency, last 8 hours (sample)", "large-heavy")
table = Table([endpoint, trend, p95])
endpoint = Col("Endpoint", ["/api/search", "/api/users"])
trend = Col("Latency, ms", [s1, s2])
p95 = Col("p95", ["210 ms", "43 ms"])
s1 = Sparkline([120, 118, 130, 125, 160, 210, 190, 140], "warn")
s2 = Sparkline([40, 42, 41, 39, 43, 40, 38, 41], "good")`,
    SegmentedBar: `root = Stack([title, bar])
title = TextContent("Where the week went (sample)", "large-heavy")
bar = SegmentedBar([deep, meet, review, admin], "h")
deep = SegmentedBarPart("Deep work", 18)
meet = SegmentedBarPart("Meetings", 9.5)
review = SegmentedBarPart("Code review", 6)
admin = SegmentedBarPart("Admin", 3, "neutral")`,
    SegmentedBarPart: `root = Stack([bar])
bar = SegmentedBar([passed, failed, skipped])
passed = SegmentedBarPart("Passed", 412, "good")
failed = SegmentedBarPart("Failed", 7, "bad")
skipped = SegmentedBarPart("Skipped", 21, "neutral")`,
    CalendarHeatmap: `root = Stack([cal])
cal = CalendarHeatmap({"2026-08-03": 30, "2026-08-04": 45, "2026-08-06": 60, "2026-08-09": 20, "2026-08-11": 40, "2026-08-12": 90, "2026-08-13": 35, "2026-08-17": 50, "2026-08-18": 30, "2026-08-20": 75, "2026-08-24": 40, "2026-08-26": 25, "2026-08-27": 60, "2026-08-30": 45, "2026-09-01": 80, "2026-09-02": 30, "2026-09-07": 55, "2026-09-08": 40, "2026-09-10": 70, "2026-09-14": 35, "2026-09-16": 65, "2026-09-17": 20, "2026-09-21": 50, "2026-09-23": 85, "2026-09-27": 40, "2026-09-29": 30}, "Workout minutes, sample")`,
    Treemap: `root = Stack([title, map])
title = TextContent("Source size by file (sample)", "large-heavy")
map = Treemap([{path: "core/markdown.ts", size: 74}, {path: "core/evaluate.ts", size: 29}, {path: "core/validate.ts", size: 24}, {path: "core/parser.ts", size: 12}, {path: "ui/components/Chart.tsx", size: 23}, {path: "ui/components/Map.tsx", size: 26}, {path: "ui/components/Tests.tsx", size: 28}, {path: "ui/app.tsx", size: 9}, {path: "server.ts", size: 18}], "KB")`,
    Histogram: `root = Stack([hist])
hist = Histogram([61, 68, 72, 75, 77, 79, 81, 83, 84, 86, 88, 89, 91, 93, 94, 96, 98, 101, 104, 107, 111, 115, 120, 126, 133, 141, 152, 168, 190, 236], null, "API latency, 30 sample requests", "ms")`,
    BoxPlot: `root = Stack([title, box])
title = TextContent("Production build time, 12 sample runs each", "large-heavy")
box = BoxPlot([{label: "esbuild", values: [1.8, 1.9, 1.9, 2.0, 2.0, 2.1, 2.1, 2.2, 2.2, 2.3, 2.4, 3.9]}, {label: "vite", values: [4.1, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9, 5.0, 5.2, 5.3, 5.6, 5.9]}, {label: "webpack", values: [9.8, 10.4, 10.9, 11.2, 11.5, 11.8, 12.1, 12.6, 13.0, 13.4, 14.1, 19.7]}], "s")`,
    Heatmap: `root = Stack([title, map])
title = TextContent("Builds by day and hour (sample)", "large-heavy")
map = Heatmap(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ["00", "03", "06", "09", "12", "15", "18", "21"], [[1, 0, 2, 14, 22, 19, 9, 3], [0, 0, 3, 17, 25, 21, 12, 4], [2, 1, 2, 15, 28, 24, 10, 2], [1, 0, 4, 18, 26, 30, 14, 6], [0, 0, 1, 12, 19, 11, 4, 1], [0, 0, 0, 2, 3, 1, 0, null], [0, 0, 0, 1, 2, 2, 1, 0]], "builds")`,
    Funnel: `root = Stack([title, funnel])
title = TextContent("Signup funnel, September (sample)", "large-heavy")
funnel = Funnel([{label: "Visited pricing", value: 12400}, {label: "Started trial", value: 5210}, {label: "Activated", value: 2380}, {label: "Paid", value: 610}])`,
    KeyValue: `root = Stack([title, facts])
title = TextContent("Pull request 482", "large-heavy")
facts = KeyValue({Branch: "fix/upload-race", Author: "sam", Checks: Tag("2 failing"), Updated: "2 hours ago"})`,
    Grid: `root = Stack([grid])
grid = Grid([api, worker, search, billing], 2)
api = KeyValue({Service: "API", Status: "Healthy", p95: "120 ms"})
worker = KeyValue({Service: "Worker", Status: "Degraded", Queue: "4.2k jobs"})
search = KeyValue({Service: "Search", Status: "Healthy", p95: "40 ms"})
billing = KeyValue({Service: "Billing", Status: "Down", Since: "09:12"})`,
  },
};
