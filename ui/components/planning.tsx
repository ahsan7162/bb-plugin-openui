// Time and planning: timelines, calendars, roadmaps, boards, status, plans to
// approve, weighted decisions, three-point estimates and acceptance grids.
// Styles: planning.css (bbui-planning-*). Pure logic: planning/logic.ts.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { ArrowRight, Ban, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CircleHelp, CircleX, Info, Minus, Plus, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button, EmptyState, TONES, cx, fmt, useAsk, useStreaming, type Tone } from "./kit";
import { useThreadFile } from "../data";
import type { ExtraGroup } from "./types";
import {
  dayOf, humanize, monthGrid, monthKey, monthOf, monthShort, monthTitle, ordered, pert, rank, shiftMonth, shortDate, today, totals, weightedScore,
  type Month,
} from "./planning/logic";

const tone = z.enum(["neutral", "accent", "good", "warn", "bad", "info"]);

/** Props of each child that has arrived; streaming may hand us nulls or partial objects. */
function rows<T>(value: unknown): Partial<T>[] {
  return (Array.isArray(value) ? value : [])
    .map((node) => (node as { props?: unknown } | null)?.props)
    .filter((p): p is Partial<T> => p !== null && typeof p === "object");
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const toneVar = (t: Tone | undefined) => ({ "--bbui-planning-tone": TONES[t ?? "neutral"] ?? TONES.neutral }) as CSSProperties;
/** A yyyy-mm-dd as "Oct 5"; anything else as written. */
const dateText = (text: string | undefined) => {
  const day = dayOf(text);
  return day === null ? (text ?? "") : shortDate(day);
};

/** A state as icon + word; the colour only repeats what the word says. */
function State({ icon: Icon, tone: t, children }: { icon: LucideIcon; tone: Tone; children: ReactNode }) {
  return (
    <span className="bbui-planning-state" style={toneVar(t)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Timeline

const timelineItem = z.object({ time: z.string(), title: z.string(), detail: z.string().optional(), tone: tone.optional() });
const TONE_ICON: Partial<Record<Tone, [LucideIcon, string]>> = {
  good: [CircleCheck, "Good"],
  warn: [TriangleAlert, "Warning"],
  bad: [CircleX, "Problem"],
  info: [Info, "Note"],
};

const TimelineItem = defineComponent({ name: "TimelineItem", props: timelineItem, description: "One event: time as written (date or clock), title, optional detail.", component: () => null });

const Timeline = defineComponent({
  name: "Timeline",
  props: z.object({ items: z.array(TimelineItem.ref) }),
  description: "Dated events in order down a rail: incidents, histories, changelogs. tone only for real state (good, warn, bad).",
  component: ({ props }) => {
    const items = rows<z.infer<typeof timelineItem>>(props.items);
    if (items.length === 0) return <EmptyState title="No events yet" hint="Add TimelineItem(time, title) entries." />;
    return (
      <ol className="bbui bbui-planning-timeline">
        {items.map((it, i) => {
          const mark = it.tone ? TONE_ICON[it.tone] : undefined;
          const Icon = mark?.[0];
          return (
            <li key={i} className="bbui-planning-event" style={toneVar(it.tone)}>
              <span className={cx("bbui-planning-mark", Icon && "bbui-planning-mark-icon", it.tone === "accent" && "bbui-planning-mark-accent")}>
                {Icon ? <Icon size={14} strokeWidth={1.75} role="img" aria-label={mark![1]} /> : null}
              </span>
              <time className="bbui-label">{it.time}</time>
              <span className="bbui-head">{it.title}</span>
              {it.detail ? <p className="bbui-label bbui-planning-detail">{it.detail}</p> : null}
            </li>
          );
        })}
      </ol>
    );
  },
});

// ---------------------------------------------------------------- Calendar

const calendarEvent = z.object({ date: z.string(), title: z.string(), tone: tone.optional() });
const CalendarEvent = defineComponent({ name: "CalendarEvent", props: calendarEvent, description: "One event on a day, date as yyyy-mm-dd.", component: () => null });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHIPS_PER_DAY = 3;

const Calendar = defineComponent({
  name: "Calendar",
  props: z.object({ events: z.array(CalendarEvent.ref), month: z.string().optional() }),
  description: "Month grid of events with previous/next month; an agenda list on narrow widths. month (yyyy-mm) defaults to the first event's month.",
  component: ({ props }) => {
    const streaming = useStreaming();
    const [offset, setOffset] = useState(0);
    const events = rows<z.infer<typeof calendarEvent>>(props.events).filter((e) => dayOf(e.date) !== null && e.title);
    const now = today();
    const base: Month = monthOf(props.month) ?? monthOf(events[0]?.date) ?? monthOf(new Date().toISOString())!;
    const month = shiftMonth(base, offset);
    const byDay = new Map<number, typeof events>();
    for (const e of events) {
      const d = dayOf(e.date)!;
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    const weeks = monthGrid(month);
    const days = weeks.flat().filter((d): d is number => d !== null && byDay.has(d));
    const chip = (e: (typeof events)[number], key: number) => (
      <li key={key} className="bbui-planning-chip" style={toneVar(e.tone)} data-tone={e.tone ?? "neutral"} title={e.title}>
        {e.title}
      </li>
    );
    return (
      <section className="bbui bbui-planning-calendar" aria-label={`Calendar, ${monthTitle(month)}`}>
        <header className="bbui-planning-bar-head">
          <h3 className="bbui-head" aria-live="polite">{monthTitle(month)}</h3>
          <span className="bbui-planning-nav">
            <Button aria-label="Previous month" disabled={streaming} onClick={() => setOffset(offset - 1)}>
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
            </Button>
            <Button aria-label="Next month" disabled={streaming} onClick={() => setOffset(offset + 1)}>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
            </Button>
          </span>
        </header>
        <table className="bbui-planning-month">
          <thead>
            <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="bbui-label">{d}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((day, i) => {
                  if (day === null) return <td key={i} className="bbui-planning-off" />;
                  const list = byDay.get(day) ?? [];
                  return (
                    <td key={i} aria-current={day === now ? "date" : undefined} className={cx(day === now && "bbui-planning-now")}>
                      <span className="bbui-planning-daynum">{new Date(day * 86_400_000).getUTCDate()}</span>
                      {list.length > 0 ? (
                        <ul className="bbui-planning-chips">
                          {list.slice(0, CHIPS_PER_DAY).map(chip)}
                          {list.length > CHIPS_PER_DAY ? <li className="bbui-label">{list.length - CHIPS_PER_DAY} more</li> : null}
                        </ul>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <ol className="bbui-planning-agenda">
          {days.length === 0 ? <li className="bbui-label">No events in {monthTitle(month)}</li> : null}
          {days.map((day) => (
            <li key={day} className={cx(day === now && "bbui-planning-now")}>
              <span className="bbui-label">{shortDate(day)}{day === now ? ", today" : ""}</span>
              <ul className="bbui-planning-chips">{byDay.get(day)!.map(chip)}</ul>
            </li>
          ))}
        </ol>
      </section>
    );
  },
});

// ---------------------------------------------------------------- Roadmap

const roadmapStatus = z.enum(["planned", "active", "done", "at-risk", "blocked"]);
const roadmapItem = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  lane: z.string().optional(),
  status: roadmapStatus.optional(),
  milestone: z.boolean().optional(),
});
const RoadmapItem = defineComponent({
  name: "RoadmapItem",
  props: roadmapItem,
  description: "A dated bar (start/end yyyy-mm-dd) in a lane; milestone: true draws a diamond at start.",
  component: () => null,
});

/** Axis ticks: Mondays for short spans, month starts (thinned to about 6) for long ones. */
function ticks(from: number, to: number): number[] {
  const out: number[] = [];
  if (to - from <= 70) {
    const step = to - from <= 35 ? 7 : 14;
    for (let d = from + ((8 - new Date(from * 86_400_000).getUTCDay()) % 7); d <= to; d += step) out.push(d);
    return out;
  }
  for (let m = shiftMonth(monthOf(new Date(from * 86_400_000).toISOString())!, 1); ; m = shiftMonth(m, 1)) {
    const d = dayOf(`${monthKey(m)}-01`)!;
    if (d > to) break;
    out.push(d);
  }
  const every = Math.ceil(out.length / 6);
  return out.filter((_, i) => i % every === 0);
}

const Roadmap = defineComponent({
  name: "Roadmap",
  props: z.object({ items: z.array(RoadmapItem.ref) }),
  description: "Gantt of dated work by lane over a date axis, with a today line. status words the bar; milestone items are diamonds.",
  component: ({ props }) => {
    const streaming = useStreaming();
    const items = rows<z.infer<typeof roadmapItem>>(props.items)
      .map((it) => {
        const start = dayOf(it.start);
        const end = it.milestone ? start : (dayOf(it.end) ?? start);
        return start === null || end === null ? null : { ...it, start, end: Math.max(start, end) };
      })
      .filter((it) => it !== null);
    if (items.length === 0) return <EmptyState title="No dated work yet" hint="Add RoadmapItem(title, start, end) with yyyy-mm-dd dates." />;
    const from = Math.min(...items.map((i) => i.start)) - 1;
    const to = Math.max(...items.map((i) => i.end)) + 2;
    const span = to - from;
    const at = (day: number) => (day - from) / span;
    const now = today();
    const lanes = ordered(items.map((i) => i.lane ?? ""));
    const label = `Roadmap from ${shortDate(from + 1)} to ${shortDate(to - 2)}, ${items.length} items in ${lanes.length} lane${lanes.length === 1 ? "" : "s"}`;
    return (
      <figure className="bbui bbui-planning-gantt" aria-label={label}>
        <div className="bbui-planning-axis" aria-hidden>
          <span />
          <span className="bbui-planning-track">
            {(streaming ? [] : ticks(from, to)).map((d) => (
              <span key={d} className="bbui-planning-tick" style={{ "--at": at(d) } as CSSProperties}>
                {monthShort(d)} {new Date(d * 86_400_000).getUTCDate()}
              </span>
            ))}
          </span>
        </div>
        {lanes.map((lane) => (
          <div key={lane} role="group" aria-label={lane || undefined}>
            {lane ? <div className="bbui-planning-lane bbui-head">{lane}</div> : null}
            {items
              .filter((i) => (i.lane ?? "") === lane)
              .map((it, n) => {
                const status = it.status ?? "planned";
                return (
                  <div key={n} className="bbui-planning-row">
                    <span className="bbui-planning-what">
                      <span>{it.title}</span>
                      <span className="bbui-label">
                        {it.milestone ? `Milestone, ${shortDate(it.start)}` : `${shortDate(it.start)} to ${shortDate(it.end)}, ${humanize(status)}`}
                      </span>
                    </span>
                    <span className="bbui-planning-track" aria-hidden>
                      {streaming ? null : it.milestone ? (
                        <span className="bbui-planning-diamond" style={{ "--at": at(it.start + 0.5) } as CSSProperties} />
                      ) : (
                        <span
                          className="bbui-planning-span"
                          data-status={status}
                          style={{ "--at": at(it.start), "--len": (it.end - it.start + 1) / span } as CSSProperties}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
          </div>
        ))}
        {!streaming && now > from && now < to ? (
          <span className="bbui-planning-today" style={{ "--at": at(now + 0.5) } as CSSProperties}>
            <span className="bbui-label">Today</span>
          </span>
        ) : null}
      </figure>
    );
  },
});

// ---------------------------------------------------------------- Board

const boardItem = z.object({
  title: z.string(),
  status: z.string(),
  detail: z.string().optional(),
  owner: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
const BoardItem = defineComponent({ name: "BoardItem", props: boardItem, description: "One card; status names its column.", component: () => null });
const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();

const Board = defineComponent({
  name: "Board",
  props: z.object({ items: z.array(BoardItem.ref), columns: z.array(z.string()).optional() }),
  description: "Kanban board: one column per status with counts. columns sets the order (default: statuses in order of first use).",
  component: ({ props }) => {
    const items = rows<z.infer<typeof boardItem>>(props.items).filter((i) => i.title);
    const columns = ordered([...strings(props.columns), ...items.map((i) => i.status ?? "")].map(key)).filter(Boolean);
    const named = new Map([...strings(props.columns), ...items.map((i) => i.status ?? "")].reverse().map((s) => [key(s), s]));
    if (items.length === 0) return <EmptyState title="The board is empty" hint="Add BoardItem(title, status) cards." />;
    return (
      <div className="bbui bbui-planning-board" role="list" aria-label="Board" tabIndex={0}>
        {columns.map((col) => {
          const cards = items.filter((i) => key(i.status ?? "") === col);
          return (
            <section key={col} role="listitem" className="bbui-planning-column" aria-label={`${humanize(named.get(col) ?? col)}, ${cards.length}`}>
              <h3 className="bbui-planning-colhead">
                <span className="bbui-head">{humanize(named.get(col) ?? col)}</span>
                <span className="bbui-label">{cards.length}</span>
              </h3>
              {cards.length === 0 ? <p className="bbui-label bbui-planning-none">Nothing here</p> : null}
              <ul className="bbui-planning-cards">
                {cards.map((c, i) => (
                  <li key={i} className="bbui-well bbui-planning-card">
                    <span>{c.title}</span>
                    {c.detail ? <span className="bbui-label">{c.detail}</span> : null}
                    {c.owner || strings(c.tags).length ? (
                      <span className="bbui-planning-meta">
                        {c.owner ? <span className="bbui-label">{c.owner}</span> : null}
                        {strings(c.tags).map((t) => <span key={t} className="bbui-planning-tag">{t}</span>)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  },
});

// ---------------------------------------------------------------- Status

const health = z.enum(["on-track", "at-risk", "off-track", "done"]);
const HEALTH: Record<string, [LucideIcon, Tone, string]> = {
  "on-track": [ArrowRight, "good", "On track"],
  "at-risk": [TriangleAlert, "warn", "At risk"],
  "off-track": [CircleX, "bad", "Off track"],
  done: [CircleCheck, "neutral", "Done"],
};
const statusItem = z.object({
  name: z.string(),
  status: health,
  progress: z.number().optional(),
  owner: z.string().optional(),
  due: z.string().optional(),
  note: z.string().optional(),
});
const StatusItem = defineComponent({ name: "StatusItem", props: statusItem, description: "One workstream: progress 0-100, due yyyy-mm-dd.", component: () => null });

const Status = defineComponent({
  name: "Status",
  props: z.object({ items: z.array(StatusItem.ref) }),
  description: "Workstream health rows: worded status, progress, owner, due and a note. For project or release check-ins.",
  component: ({ props }) => {
    const items = rows<z.infer<typeof statusItem>>(props.items).filter((i) => i.name);
    if (items.length === 0) return <EmptyState title="No workstreams yet" hint="Add StatusItem(name, status) rows." />;
    // An unknown or missing status is never shown as on track: neutral, in its own words.
    const look = (status: string | undefined): [LucideIcon, Tone, string] =>
      (status && HEALTH[status]) || [CircleDashed, "neutral", status ? humanize(status) : "Unknown"];
    const counts = ordered(items.map((i) => look(i.status)[2]))
      .map((word) => [items.filter((i) => look(i.status)[2] === word).length, word.toLowerCase()] as const);
    return (
      <section className="bbui bbui-planning-status" aria-label="Workstream status">
        <p className="bbui-label">{counts.map(([n, word]) => `${n} ${word}`).join(", ")}</p>
        <ul className="bbui-planning-rows">
          {items.map((it, i) => {
            const [icon, t, word] = look(it.status);
            const progress = num(it.progress);
            const meta = [it.owner, it.due ? `due ${dateText(it.due)}` : ""].filter(Boolean).join(", ");
            return (
              <li key={i} className="bbui-planning-stream">
                <span className="bbui-head">{it.name}</span>
                <State icon={icon} tone={t}>{word}</State>
                {progress !== undefined ? (
                  <span className="bbui-planning-progress">
                    <span
                      className="bbui-planning-meter"
                      role="progressbar"
                      aria-label={`${it.name} progress`}
                      aria-valuenow={Math.round(Math.min(100, Math.max(0, progress)))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ "--at": Math.min(100, Math.max(0, progress)) / 100 } as CSSProperties} />
                    </span>
                    <span className="bbui-label">{fmt(progress, { decimals: 0 })}%</span>
                  </span>
                ) : null}
                {meta ? <span className="bbui-label bbui-planning-who">{meta}</span> : null}
                {it.note ? <p className="bbui-planning-note">{it.note}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  },
});

// ---------------------------------------------------------------- Plan

const risk = z.enum(["low", "medium", "high"]);
const planStep = z.object({
  title: z.string(),
  detail: z.string().optional(),
  files: z.array(z.string()).optional(),
  risk: risk.optional(),
  estimate: z.string().optional(),
});
const PlanStep = defineComponent({ name: "PlanStep", props: planStep, description: "One step: files touched, risk, estimate as written (e.g. 2h).", component: () => null });

function Sendbar({ actions }: { actions: { label: string; text: string; primary?: boolean }[] }) {
  const streaming = useStreaming();
  const ask = useAsk();
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="bbui-planning-actions">
      {actions.map((a) => (
        <Button
          key={a.label}
          variant={a.primary ? "primary" : undefined}
          state={sent === a.label ? "success" : undefined}
          disabled={streaming || sent !== null}
          onClick={() => {
            setSent(a.label);
            ask(a.text);
          }}
        >
          {sent === a.label ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden /> : null}
          {a.label}
        </Button>
      ))}
      {sent ? <span className="bbui-label" role="status">Sent</span> : null}
    </div>
  );
}

const Plan = defineComponent({
  name: "Plan",
  props: z.object({ steps: z.array(PlanStep.ref) }),
  description: "A plan the user approves before work starts: numbered steps with files, risk and estimate, then Approve or Change something.",
  component: ({ props }) => {
    const steps = rows<z.infer<typeof planStep>>(props.steps).filter((s) => s.title);
    if (steps.length === 0) return <EmptyState title="No steps yet" hint="Add PlanStep(title) entries." />;
    const high = steps.filter((s) => s.risk === "high").length;
    return (
      <section className="bbui bbui-planning-plan" aria-label="Plan">
        <p className="bbui-label">
          {steps.length} step{steps.length === 1 ? "" : "s"}
          {high ? `, ${high} high risk` : ""}
        </p>
        <ol className="bbui-planning-steps">
          {steps.map((s, i) => (
            <li key={i} className="bbui-planning-step">
              <span className="bbui-planning-num bbui-label" aria-hidden>{i + 1}</span>
              <span className="bbui-head">{s.title}</span>
              {s.detail ? <p className="bbui-label">{s.detail}</p> : null}
              {strings(s.files).length ? (
                <ul className="bbui-planning-files">
                  {strings(s.files).map((f) => <li key={f} className="bbui-mono">{f}</li>)}
                </ul>
              ) : null}
              {s.risk || s.estimate ? (
                <span className="bbui-planning-meta">
                  {s.risk === "high" ? <State icon={TriangleAlert} tone="warn">High risk</State> : s.risk ? <span className="bbui-label">{humanize(s.risk)} risk</span> : null}
                  {s.estimate ? <span className="bbui-label">{s.estimate}</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <Sendbar
          actions={[
            { label: "Approve the plan", text: "Approve the plan", primary: true },
            { label: "Change something", text: "I want to change something in the plan before you start." },
          ]}
        />
      </section>
    );
  },
});

// ---------------------------------------------------------------- Decision

const decisionOption = z.object({
  name: z.string(),
  scores: z.array(z.number()),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
});
const DecisionOption = defineComponent({ name: "DecisionOption", props: decisionOption, description: "One option: scores 1-5, one per criterion in order.", component: () => null });
const MAX_WEIGHT = 5;

function DecisionView({ options, criteria, initial }: { options: z.infer<typeof decisionOption>[]; criteria: string[]; initial: number[] }) {
  const streaming = useStreaming();
  const ask = useAsk();
  const [tuned, setTuned] = useState<number[] | null>(null);
  const [sent, setSent] = useState(false);
  const weights = criteria.map((_, i) => tuned?.[i] ?? initial[i] ?? 3);
  const order = rank(options, weights);
  const leader = options[order[0]!]!;
  const setWeight = (i: number, w: number) => setTuned(weights.map((old, j) => (j === i ? Math.min(MAX_WEIGHT, Math.max(0, w)) : old)));
  return (
    <section className="bbui bbui-planning-decision" aria-label="Decision">
      <fieldset className="bbui-planning-weights" disabled={streaming}>
        <legend className="bbui-label">Weights: how much each criterion matters, 0 to {MAX_WEIGHT}</legend>
        {criteria.map((c, i) => (
          <span key={c} className="bbui-planning-weight">
            <span>{c}</span>
            <Button aria-label={`Less weight on ${c}`} disabled={streaming || weights[i]! <= 0} onClick={() => setWeight(i, weights[i]! - 1)}>
              <Minus size={14} strokeWidth={1.75} aria-hidden />
            </Button>
            <output aria-live="polite" aria-label={`${c} weight`}>{weights[i]}</output>
            <Button aria-label={`More weight on ${c}`} disabled={streaming || weights[i]! >= MAX_WEIGHT} onClick={() => setWeight(i, weights[i]! + 1)}>
              <Plus size={14} strokeWidth={1.75} aria-hidden />
            </Button>
          </span>
        ))}
      </fieldset>
      <div className="bbui-planning-scroll" role="region" aria-label="Scores" tabIndex={0}>
        <table className="bbui-planning-table">
          <thead>
            <tr>
              <th scope="col" className="bbui-label">Option</th>
              {criteria.map((c, i) => <th key={c} scope="col" className="bbui-label bbui-planning-numcol">{c} <span>x{weights[i]}</span></th>)}
              <th scope="col" className="bbui-label bbui-planning-numcol">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {order.map((oi, r) => {
              const o = options[oi]!;
              const score = weightedScore(o.scores, weights);
              return (
                <tr key={o.name} className={cx(r === 0 && "bbui-planning-lead")}>
                  <th scope="row">
                    {o.name}
                    {r === 0 ? <span className="bbui-label"> leading</span> : null}
                  </th>
                  {criteria.map((c, i) => <td key={c} className="bbui-planning-numcol">{num(o.scores[i]) ?? "-"}</td>)}
                  <td className="bbui-planning-numcol">
                    <span className="bbui-planning-score">
                      <span className="bbui-planning-meter" aria-hidden><span style={{ "--at": score } as CSSProperties} /></span>
                      {fmt(score * 100, { decimals: 0 })}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {options.some((o) => strings(o.pros).length || strings(o.cons).length) ? (
        <dl className="bbui-planning-procon">
          {order.map((oi) => {
            const o = options[oi]!;
            if (!strings(o.pros).length && !strings(o.cons).length) return null;
            return (
              <div key={o.name}>
                <dt className="bbui-head">{o.name}</dt>
                {strings(o.pros).map((p) => <dd key={`p${p}`}><State icon={Plus} tone="good">{p}</State></dd>)}
                {strings(o.cons).map((p) => <dd key={`c${p}`}><State icon={Minus} tone="bad">{p}</State></dd>)}
              </div>
            );
          })}
        </dl>
      ) : null}
      <div className="bbui-planning-actions">
        <Button
          variant="primary"
          state={sent ? "success" : undefined}
          disabled={streaming || sent}
          onClick={() => {
            setSent(true);
            ask(`Go with ${leader.name} (weights: ${criteria.map((c, i) => `${c} ${weights[i]}`).join(", ")})`);
          }}
        >
          Go with {leader.name}
        </Button>
        {sent ? <span className="bbui-label" role="status">Sent</span> : null}
      </div>
    </section>
  );
}

const Decision = defineComponent({
  name: "Decision",
  props: z.object({ options: z.array(DecisionOption.ref), criteria: z.array(z.string()), weights: z.array(z.number()).optional() }),
  description: "Weighted comparison the user tunes: weights (0-5, default 3) per criterion re-rank options live; Go with X sends the pick.",
  component: ({ props }) => {
    const options = rows<z.infer<typeof decisionOption>>(props.options)
      .filter((o) => o.name)
      .map((o) => ({ ...o, name: o.name!, scores: (Array.isArray(o.scores) ? o.scores : []).map(Number) }));
    const criteria = strings(props.criteria);
    if (options.length === 0 || criteria.length === 0) return <EmptyState title="Nothing to compare yet" hint="Add DecisionOption(name, scores) and a list of criteria." />;
    return <DecisionView options={options} criteria={criteria} initial={(props.weights ?? []).map(Number)} />;
  },
});

// ---------------------------------------------------------------- Choice

const choiceOption = z.object({
  title: z.string(),
  points: z.array(z.string()).optional(),
  image: z.string().optional(),
  tags: z.array(z.string()).optional(),
  recommended: z.boolean().optional(),
});
const ChoiceOption = defineComponent({
  name: "ChoiceOption",
  props: choiceOption,
  description: "One option: title, 2-4 short points, an optional preview image (workspace path or https URL), small tags, recommended.",
  component: () => null,
});

function ChoiceImage({ src, alt }: { src: string; alt: string }) {
  const url = /^https?:\/\//i.test(src);
  const file = useThreadFile(url ? null : src, { media: true });
  if (url) return <img className="bbui-planning-choice-img" src={src} alt={alt} />;
  if (file.state === "ready") return <img className="bbui-planning-choice-img" src={file.value} alt={alt} />;
  return (
    <div className="bbui-planning-choice-img" role={file.state === "error" ? "img" : "status"} aria-label={file.state === "error" ? `${alt}: preview unavailable` : "Loading preview"}>
      {file.state === "error" ? <span className="bbui-label">Preview unavailable</span> : null}
    </div>
  );
}

function ChoiceView({ options, question, other }: { options: z.infer<typeof choiceOption>[]; question?: string; other?: string }) {
  const streaming = useStreaming();
  const ask = useAsk();
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const done = streaming || picked !== null;
  const send = (choice: string, text: string) => {
    setPicked(choice);
    ask(text);
  };
  const go = (i: number) => {
    const list = track.current;
    const slide = list?.children[Math.max(0, Math.min(options.length - 1, i))] as HTMLElement | undefined;
    if (!list || !slide) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: slide.offsetLeft - list.offsetLeft, behavior: smooth ? "smooth" : "auto" });
  };
  // Scroll-snap does the moving (swipe, trackpad, arrow keys); this only follows which slide is in view.
  const onScroll = () => {
    const list = track.current;
    const step = list && list.children.length > 1 ? (list.children[1] as HTMLElement).offsetLeft - (list.children[0] as HTMLElement).offsetLeft : 0;
    if (list && step > 0) setActive(Math.min(options.length - 1, Math.round(list.scrollLeft / step)));
  };
  const many = options.length > 1;
  return (
    <section className="bbui bbui-planning-choice" aria-label={question || "Choose an option"} aria-roledescription="carousel">
      <div className="bbui-planning-choice-top">
        {question ? <p className="bbui-head">{question}</p> : <span />}
        {many ? (
          <div className="bbui-planning-choice-nav">
            <span className="bbui-label" aria-live="polite">{active + 1} / {options.length}</span>
            <Button className="bbui-planning-choice-arrow" aria-label="Previous option" disabled={active === 0} onClick={() => go(active - 1)}>
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
            </Button>
            <Button className="bbui-planning-choice-arrow" aria-label="Next option" disabled={active === options.length - 1} onClick={() => go(active + 1)}>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      <ul ref={track} className="bbui-planning-choices" data-many={many || undefined} onScroll={onScroll} tabIndex={0} aria-label="Options">
        {options.map((o, i) => (
          <li
            key={o.title}
            className="bbui-planning-choice-card"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${options.length}: ${o.title}`}
            data-recommended={o.recommended || undefined}
            data-picked={picked === o.title || undefined}
          >
            {o.image ? <ChoiceImage src={o.image} alt={o.title} /> : null}
            <div className="bbui-planning-choice-body">
              <div className="bbui-planning-meta">
                <h3 className="bbui-head">{o.title}</h3>
                {o.recommended ? <span className="bbui-planning-choice-tag" data-tone="accent">Recommended</span> : null}
              </div>
              {strings(o.tags).length ? (
                <div className="bbui-planning-meta">
                  {strings(o.tags).map((t) => <span key={t} className="bbui-planning-choice-tag">{t}</span>)}
                </div>
              ) : null}
              {strings(o.points).length ? (
                <ul className="bbui-planning-choice-points">
                  {strings(o.points).map((p) => <li key={p}>{p}</li>)}
                </ul>
              ) : null}
            </div>
            <div className="bbui-planning-actions bbui-planning-choice-foot">
              <Button
                variant={o.recommended ? "primary" : undefined}
                state={picked === o.title ? "success" : undefined}
                disabled={done}
                aria-label={`Choose ${o.title}`}
                onClick={() => send(o.title, `Go with ${o.title}`)}
              >
                {picked === o.title ? <><CircleCheck size={14} strokeWidth={1.75} aria-hidden /> {o.title}</> : o.title}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {many ? (
        <div className="bbui-planning-choice-dots">
          {options.map((o, i) => (
            <button key={o.title} type="button" aria-label={`Show ${o.title}`} aria-current={i === active || undefined} onClick={() => go(i)} />
          ))}
        </div>
      ) : null}
      {other !== undefined ? (
        <form
          className="bbui-planning-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) send("", draft.trim());
          }}
        >
          <input
            className="bbui-inputs-field bbui-planning-choice-other"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={other || "Something else…"}
            aria-label={other || "Something else"}
            disabled={done}
          />
          <Button type="submit" disabled={done || !draft.trim()}>Send</Button>
        </form>
      ) : null}
      {picked !== null ? <span className="bbui-label" role="status">Sent</span> : null}
    </section>
  );
}

const Choice = defineComponent({
  name: "Choice",
  props: z.object({ options: z.array(ChoiceOption.ref), question: z.string().optional(), other: z.string().optional() }),
  description:
    'Options the user picks from, one large slide each in a carousel (arrows, dots, swipe): directions, designs, approaches. Each slide shows its image full width, then the points and a button labelled with the title that sends "Go with <title>". other (a placeholder, "" for the default) adds a free-text answer box.',
  component: ({ props }) => {
    const options = rows<z.infer<typeof choiceOption>>(props.options)
      .filter((o) => o.title)
      .map((o) => ({ ...o, title: o.title! }));
    if (options.length === 0) return <EmptyState title="No options yet" hint="Add ChoiceOption(title, points)." />;
    return <ChoiceView options={options} question={props.question || undefined} other={typeof props.other === "string" ? props.other : undefined} />;
  },
});

// ---------------------------------------------------------------- Estimate

const estimateTask = z.object({ title: z.string(), low: z.number(), high: z.number(), likely: z.number().optional() });
const EstimateTask = defineComponent({ name: "EstimateTask", props: estimateTask, description: "One task: low, high and optional most likely.", component: () => null });

const Estimate = defineComponent({
  name: "Estimate",
  props: z.object({ tasks: z.array(EstimateTask.ref), unit: z.string().optional() }),
  description: "Three-point estimates: a range bar and PERT mean per task, total P50 and P90. unit as written, e.g. h, d, points.",
  component: ({ props }) => {
    const streaming = useStreaming();
    const tasks = rows<z.infer<typeof estimateTask>>(props.tasks)
      .filter((t) => t.title && num(t.low) !== undefined && num(t.high) !== undefined)
      .map((t) => ({ title: t.title!, low: Math.min(t.low!, t.high!), high: Math.max(t.low!, t.high!), likely: num(t.likely) }));
    if (tasks.length === 0) return <EmptyState title="No tasks to estimate" hint="Add EstimateTask(title, low, high, likely)." />;
    const unit = props.unit || undefined;
    const total = totals(tasks);
    const top = Math.max(...tasks.map((t) => t.high)) || 1;
    const pct = (v: number) => `${(Math.max(0, v) / top) * 100}%`;
    return (
      <section className="bbui bbui-planning-estimate" aria-label="Estimate">
        <dl className="bbui-planning-figures">
          <div>
            <dt className="bbui-label">P50, even odds</dt>
            <dd className="bbui-figure">{fmt(total.p50, { decimals: 1, unit })}</dd>
          </div>
          <div>
            <dt className="bbui-label">P90, safe to commit</dt>
            <dd className="bbui-figure">{fmt(total.p90, { decimals: 1, unit })}</dd>
          </div>
          <div>
            <dt className="bbui-label">Best to worst case</dt>
            <dd className="bbui-head">
              {fmt(tasks.reduce((s, t) => s + t.low, 0), { decimals: 1 })} to {fmt(tasks.reduce((s, t) => s + t.high, 0), { decimals: 1, unit })}
            </dd>
          </div>
        </dl>
        <ul className="bbui-planning-tasks">
          {tasks.map((t, i) => {
            const p = pert(t.low, t.high, t.likely);
            const likely = t.likely ?? (t.low + t.high) / 2;
            return (
              <li key={i} className="bbui-planning-task">
                <span>{t.title}</span>
                <span className="bbui-label bbui-planning-numcol">
                  {fmt(t.low)} to {fmt(t.high, { unit })}, mean {fmt(p.mean, { decimals: 1 })}
                </span>
                {streaming ? null : <svg
                  className="bbui-planning-range"
                  width="100%"
                  height="12"
                  role="img"
                  aria-label={`${t.title}: low ${fmt(t.low)}, likely ${fmt(likely)}, high ${fmt(t.high, { unit })}`}
                >
                  <rect className="bbui-planning-range-band" x={pct(t.low)} width={pct(Math.max(t.high - t.low, top * 0.005))} y="3" height="6" rx="2" />
                  <rect className="bbui-planning-range-mark" x={pct(likely)} width="2" y="0" height="12" />
                </svg>}
              </li>
            );
          })}
        </ul>
        <p className="bbui-label">
          PERT mean per task; P50 and P90 assume the tasks are independent. A task without a likely value uses the middle of its range.
        </p>
      </section>
    );
  },
});

// ---------------------------------------------------------------- Acceptance

const verdict = z.enum(["passed", "failed", "blocked", "untested", "claimed"]);
type Verdict = z.infer<typeof verdict>;
const VERDICT: Record<Verdict, [LucideIcon, Tone, string]> = {
  passed: [CircleCheck, "good", "Passed"],
  failed: [CircleX, "bad", "Failed"],
  blocked: [Ban, "warn", "Blocked"],
  claimed: [CircleHelp, "info", "Claimed, not checked"],
  untested: [CircleDashed, "neutral", "Untested"],
};
const acceptanceCriterion = z.object({
  name: z.string(),
  status: verdict.optional(),
  note: z.string().optional(),
  evidence: z.string().optional(),
  cells: z.array(verdict).optional(),
});
const AcceptanceCriterion = defineComponent({
  name: "AcceptanceCriterion",
  props: acceptanceCriterion,
  description: "One criterion: overall status, note, evidence (path, command or URL), cells = a status per column.",
  component: () => null,
});
const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && v in VERDICT;
const VerdictWord = ({ v }: { v: Verdict }) => <State icon={VERDICT[v][0]} tone={VERDICT[v][1]}>{VERDICT[v][2]}</State>;

const Acceptance = defineComponent({
  name: "Acceptance",
  props: z.object({ criteria: z.array(AcceptanceCriterion.ref), columns: z.array(z.string()).optional() }),
  description: "Is it really done: criteria with worded status and evidence, summary counts. columns (e.g. Claimed, Checked) give a grid via cells.",
  component: ({ props }) => {
    const criteria = rows<z.infer<typeof acceptanceCriterion>>(props.criteria).filter((c) => c.name);
    const columns = strings(props.columns);
    if (criteria.length === 0) return <EmptyState title="No criteria yet" hint="Add AcceptanceCriterion(name, status) rows." />;
    // The row's verdict: its own status, else its last checked cell.
    const final = (c: (typeof criteria)[number]): Verdict =>
      isVerdict(c.status) ? c.status : ([...(c.cells ?? [])].reverse().find(isVerdict) ?? "untested");
    const verdicts = criteria.map(final);
    const passed = verdicts.filter((v) => v === "passed").length;
    const counts = (Object.keys(VERDICT) as Verdict[]).map((v) => [verdicts.filter((x) => x === v).length, v] as const).filter(([n]) => n > 0);
    const done = passed === criteria.length;
    return (
      <section className="bbui bbui-planning-acceptance" aria-label="Acceptance">
        <header className="bbui-planning-verdict">
          <State icon={done ? CircleCheck : CircleDashed} tone={done ? "good" : "neutral"}>
            <span className="bbui-head">{done ? `Done: all ${criteria.length} criteria passed` : `Not done: ${passed} of ${criteria.length} criteria passed`}</span>
          </State>
          <span className="bbui-label">{counts.map(([n, v]) => `${n} ${v}`).join(", ")}</span>
        </header>
        <div className="bbui-planning-scroll" role="region" aria-label="Criteria" tabIndex={0}>
          <table className="bbui-planning-table">
            <thead>
              <tr>
                <th scope="col" className="bbui-label">Criterion</th>
                {(columns.length ? columns : ["Status"]).map((c) => <th key={c} scope="col" className="bbui-label">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {criteria.map((c, i) => (
                <tr key={i}>
                  <th scope="row">
                    <span className="bbui-planning-crit">
                      <span>{c.name}</span>
                      {c.note ? <span className="bbui-label bbui-planning-cellnote">{c.note}</span> : null}
                      {c.evidence ? <span className="bbui-mono bbui-planning-evidence">{c.evidence}</span> : null}
                    </span>
                  </th>
                  {columns.length ? (
                    columns.map((col, j) => {
                      const v = c.cells?.[j] ?? (j === columns.length - 1 && !c.cells?.length ? c.status : undefined);
                      return <td key={col}>{isVerdict(v) ? <VerdictWord v={v} /> : <span className="bbui-label">-</span>}</td>;
                    })
                  ) : (
                    <td><VerdictWord v={verdicts[i]!} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  },
});

// ---------------------------------------------------------------- Group

const examples: Record<string, string> = {
  Timeline: `root = Stack([t])
t = Timeline([
  TimelineItem("09:12", "Deploy started", "v2.4.0 to production"),
  TimelineItem("09:20", "Error rate up", "5xx at 2.1% on checkout", "bad"),
  TimelineItem("09:31", "Rolled back to v2.3.9", null, "warn"),
  TimelineItem("09:40", "Recovered", "5xx back under 0.1%", "good")
])`,
  Calendar: `root = Stack([c])
c = Calendar([
  CalendarEvent("2026-11-02", "Feature freeze", "warn"),
  CalendarEvent("2026-11-05", "RC 1"),
  CalendarEvent("2026-11-05", "Docs review"),
  CalendarEvent("2026-11-12", "RC 2"),
  CalendarEvent("2026-11-18", "Security review", "bad"),
  CalendarEvent("2026-11-18", "Changelog draft"),
  CalendarEvent("2026-11-18", "Perf pass"),
  CalendarEvent("2026-11-18", "Translations"),
  CalendarEvent("2026-11-25", "Release 3.0", "good"),
  CalendarEvent("2026-12-02", "Retro")
], "2026-11")`,
  Roadmap: `root = Stack([r])
r = Roadmap([
  RoadmapItem("Brand refresh", "2026-10-05", "2026-10-23", "Design", "done"),
  RoadmapItem("Marketing site", "2026-10-19", "2026-11-13", "Design", "active"),
  RoadmapItem("Billing v2", "2026-10-12", "2026-11-06", "Product", "done"),
  RoadmapItem("Onboarding checklist", "2026-11-02", "2026-11-20", "Product", "at-risk"),
  RoadmapItem("Waitlist invites", "2026-11-09", "2026-11-20", "Product", "blocked"),
  RoadmapItem("Load test", "2026-11-16", "2026-11-25", "Infra", "planned"),
  RoadmapItem("Public beta", "2026-11-26", "2026-11-26", "Launch", null, true),
  RoadmapItem("Launch day", "2026-12-03", "2026-12-03", "Launch", null, true)
])`,
  Board: `root = Stack([b])
b = Board([
  BoardItem("Pricing page: annual toggle", "In progress", "Show VAT-inclusive prices for EU visitors.", "Marta Rossi", ["web", "billing"]),
  BoardItem("Onboarding checklist", "In review", null, "Jon Park", ["app"]),
  BoardItem("Status page", "To do", null, null, ["infra"]),
  BoardItem("Load test signup at 5x", "To do", null, "Dev Patel", ["infra"]),
  BoardItem("Waitlist invite emails", "Blocked", "Waiting on the DKIM record.", "Marta Rossi"),
  BoardItem("Brand refresh", "Done", null, "Ana Lima")
], ["To do", "In progress", "In review", "Blocked", "Done"])`,
  Status: `root = Stack([s])
s = Status([
  StatusItem("Marketing site", "on-track", 70, "Marta Rossi", "2026-11-13", "Pricing page in review; the rest is on staging."),
  StatusItem("Onboarding", "at-risk", 40, "Jon Park", "2026-11-20", "Copy changed late; needs a call on checklist order by Monday."),
  StatusItem("Press kit", "off-track", 60, "Ana Lima", "2026-11-06", "Founder photos missing; past the agency deadline."),
  StatusItem("Billing v2", "done", 100, "Jon Park", "2026-11-06")
])`,
  Plan: `root = Stack([p])
p = Plan([
  PlanStep("Honour 429 and Retry-After in safeGet", "Return the wait instead of failing, capped at 60s.", ["web/net.ts"], "medium", "2h"),
  PlanStep("Per-host token bucket", "Replaces the global limiter.", ["web/lookups.ts"], "medium", "3h"),
  PlanStep("Keep 429s out of the cache", "A rate-limited miss must not be cached for a day.", ["web/cache.ts"], "high", "1h"),
  PlanStep("Tests for bucket timing and Retry-After parsing", null, ["web/web.test.ts"], "low", "1.5h")
])`,
  Decision: `root = Stack([d])
d = Decision([
  DecisionOption("pg-boss", [4, 5, 4, 4], ["Runs on the Postgres we already operate"], ["Polling adds load at high volume"]),
  DecisionOption("BullMQ", [5, 2, 4, 4], ["Fastest of the three"], ["Needs Redis with persistence, which we don't run"]),
  DecisionOption("Graphile Worker", [4, 5, 4, 3], ["LISTEN/NOTIFY, no polling delay"], ["Smaller community"])
], ["Throughput", "Ops cost", "Delivery guarantees", "Local development"], [3, 5, 4, 2])`,
  Estimate: `root = Stack([e])
e = Estimate([
  EstimateTask("Environments RPCs in server.ts", 1, 3, 1.5),
  EstimateTask("Lazy per-row git status", 1, 4, 2),
  EstimateTask("Dashboard UI", 2, 5, 3),
  EstimateTask("Polling with backoff", 0.5, 2, 1),
  EstimateTask("Non-git environments", 0.5, 3)
], "d")`,
  Choice: `root = Stack([c])
c = Choice([
  ChoiceOption("A · Fence Drop", ["Code is typed, and each block it describes slams out of it", "Ends on a click that becomes the user's next message"], "launch-film/directions/a.png", ["128 BPM", "20 s"], true),
  ChoiceOption("B · Thread in Space", ["A bb thread in 3D; the camera dives through real blocks", "Lands on the line Replies you can click"], "launch-film/directions/b.png", ["120 BPM", "20 s"]),
  ChoiceOption("C · Slot Wall", ["Rows of blocks spin and stop on every beat", "The jumpiest of the three"], "launch-film/directions/c.png", ["132 BPM", "20 s"])
], "Which direction should the launch film take?", "Mix two, or describe your own")`,
  Acceptance: `root = Stack([a])
a = Acceptance([
  AcceptanceCriterion("Example renders with no errors", null, "Chromium at 1300px and 393px", "shots/gate-light.png", ["passed", "passed"]),
  AcceptanceCriterion("Logic tests pass", null, null, "npx tsx --test ui/components/planning.test.ts", ["passed", "passed"]),
  AcceptanceCriterion("Screen reader names every cell", null, "Not walked with VoiceOver", null, ["claimed", "untested"]),
  AcceptanceCriterion("Works offline", null, "Service worker not registered", null, ["claimed", "failed"])
], ["Claimed", "Checked"])`,
};
for (const [child, parent] of Object.entries({
  TimelineItem: "Timeline", CalendarEvent: "Calendar", RoadmapItem: "Roadmap", BoardItem: "Board", StatusItem: "Status",
  PlanStep: "Plan", DecisionOption: "Decision", ChoiceOption: "Choice", EstimateTask: "Estimate", AcceptanceCriterion: "Acceptance",
})) examples[child] = examples[parent]!;

export const planningGroup: ExtraGroup = {
  name: "Time and planning",
  notes: [
    "Dates are yyyy-mm-dd; months yyyy-mm.",
    "Plan, Decision and Choice send the user's answer as their next message; put one per reply, last.",
    "Offering options to pick from (directions, designs, approaches)? Use Choice, not prose plus Buttons; use Decision only when options score against criteria.",
  ],
  components: [
    Timeline, TimelineItem, Calendar, CalendarEvent, Roadmap, RoadmapItem, Board, BoardItem, Status, StatusItem,
    Plan, PlanStep, Decision, DecisionOption, Choice, ChoiceOption, Estimate, EstimateTask, Acceptance, AcceptanceCriterion,
  ],
  examples,
};
