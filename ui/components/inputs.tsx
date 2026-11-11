// Inputs and learning: small controls a program can read through a $binding (Stepper, Rating,
// ListEditor, Swatches), one-click follow-ups, a Timer, and step-at-a-time learning blocks
// (Quiz, Flashcards, Walkthrough). Styles: inputs.css. Pure logic: inputs/logic.ts.
import { useEffect, useId, useState } from "react";
import { defineComponent, reactive, useStateField } from "@openuidev/react-lang";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { z } from "zod/v4";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, CornerDownRight, Minus, Pause, Play, Plus, RotateCcw, Star, X } from "lucide-react";
import { Button, cx, useAsk, useStreaming } from "./kit";
import type { ExtraGroup } from "./types";
import { clock, codeFence, moveItem, quizScore, removeAt, replaceAt, stepTo } from "./inputs/logic";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
/** The props of child components that have arrived; while streaming they may be partial. */
function childProps(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((node) => {
    const props = node && typeof node === "object" ? (node as { props?: unknown }).props : undefined;
    return props && typeof props === "object" ? [props as Record<string, unknown>] : [];
  });
}

// ---------------------------------------------------------------- Stepper

const Stepper = defineComponent({
  name: "Stepper",
  description: "A count with minus and plus buttons and a typed field (guests, servings, seats). Bind value to a $var to use it elsewhere.",
  props: z.object({
    name: z.string(),
    value: reactive(z.number().optional()),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    label: z.string().optional(),
  }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const field = useStateField(props.name, props.value);
    const [draft, setDraft] = useState<string | null>(null);
    const id = useId();
    const min = num(props.min) ?? -Infinity;
    const max = num(props.max) ?? Infinity;
    const step = (num(props.step) ?? 0) > 0 ? props.step! : 1;
    const value = num(field.value) ?? stepTo(Number.isFinite(min) ? min : 0, 0, step, min, max);
    const set = (n: number) => field.setValue(stepTo(n, 0, step, min, max));
    const invalid = draft !== null && (draft.trim() === "" || !Number.isFinite(Number(draft)));
    const commit = () => {
      if (draft !== null && !invalid) set(Number(draft));
      setDraft(null);
    };
    const label = props.label ?? props.name;
    return (
      <div className="bbui bbui-inputs-stack">
        {props.label ? (
          <label className="bbui-label" htmlFor={id}>
            {props.label}
          </label>
        ) : null}
        <div className="bbui-inputs-stepper" role="group" aria-label={label}>
          <Button className="bbui-inputs-icon" aria-label={`Decrease ${label}`} disabled={streaming || value <= min} onClick={() => set(value - step)}>
            <Minus {...ICON} />
          </Button>
          <input
            id={id}
            className="bbui-inputs-field bbui-inputs-number"
            type="number"
            inputMode="decimal"
            min={Number.isFinite(min) ? min : undefined}
            max={Number.isFinite(max) ? max : undefined}
            step={step}
            aria-label={props.label ? undefined : label}
            value={draft ?? String(value)}
            aria-invalid={invalid || undefined}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          <Button className="bbui-inputs-icon" aria-label={`Increase ${label}`} disabled={streaming || value >= max} onClick={() => set(value + step)}>
            <Plus {...ICON} />
          </Button>
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------- Rating

const Rating = defineComponent({
  name: "Rating",
  description: "1 to max stars (default 5) picked by click or arrow keys. Bind value to a $var to read the rating.",
  props: z.object({
    name: z.string(),
    value: reactive(z.number().optional()),
    max: z.number().optional(),
    label: z.string().optional(),
  }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const field = useStateField(props.name, props.value);
    const group = useId();
    const count = Math.min(10, Math.max(1, Math.round(num(props.max) ?? 5)));
    const value = num(field.value) ?? 0;
    return (
      <fieldset className="bbui bbui-inputs-rating" disabled={streaming}>
        <legend className="bbui-label">{props.label ?? "Rating"}</legend>
        <div className="bbui-inputs-stars">
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <label key={n} className={cx("bbui-inputs-star", n <= value && "is-on")}>
              <input
                className="bbui-inputs-sr"
                type="radio"
                name={group}
                value={n}
                checked={value === n}
                onChange={() => field.setValue(n)}
                aria-label={`${n} of ${count}`}
              />
              <Star {...ICON} />
            </label>
          ))}
          <span className="bbui-label" aria-hidden="true">
            {value > 0 ? `${value} of ${count}` : "Not rated"}
          </span>
        </div>
      </fieldset>
    );
  },
});

// ---------------------------------------------------------------- ListEditor

const ListEditor = defineComponent({
  name: "ListEditor",
  description: "An editable list of short strings: add, edit, reorder and remove (labels, steps, names). Bind value to a $var holding a string array.",
  props: z.object({
    name: z.string(),
    value: reactive(z.array(z.string()).optional()),
    label: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const field = useStateField(props.name, props.value);
    const [draft, setDraft] = useState("");
    const labelId = useId();
    const list = strings(field.value);
    const label = props.label ?? props.name;
    const add = () => {
      const text = draft.trim();
      if (!text) return;
      field.setValue([...list, text]);
      setDraft("");
    };
    return (
      <div className="bbui bbui-inputs-stack" role="group" aria-labelledby={labelId}>
        <span className="bbui-label" id={labelId}>
          {label}
        </span>
        {list.length > 0 ? (
          <ol className="bbui-inputs-rows">
            {list.map((item, i) => (
              <li key={i} className="bbui-inputs-row">
                <input
                  className="bbui-inputs-field"
                  value={item}
                  aria-label={`Item ${i + 1}`}
                  disabled={streaming}
                  onChange={(e) => field.setValue(replaceAt(list, i, e.target.value))}
                />
                <Button className="bbui-inputs-icon" aria-label={`Move item ${i + 1} up`} disabled={streaming || i === 0} onClick={() => field.setValue(moveItem(list, i, -1))}>
                  <ArrowUp {...ICON} />
                </Button>
                <Button
                  className="bbui-inputs-icon"
                  aria-label={`Move item ${i + 1} down`}
                  disabled={streaming || i === list.length - 1}
                  onClick={() => field.setValue(moveItem(list, i, 1))}
                >
                  <ArrowDown {...ICON} />
                </Button>
                <Button className="bbui-inputs-icon" aria-label={`Remove item ${i + 1}`} disabled={streaming} onClick={() => field.setValue(removeAt(list, i))}>
                  <X {...ICON} />
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <span className="bbui-label">The list is empty. Type below and press Enter to add the first item.</span>
        )}
        <div className="bbui-inputs-row">
          <input
            className="bbui-inputs-field"
            value={draft}
            placeholder={props.placeholder ?? "Add an item"}
            aria-label={`New item for ${label}`}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button disabled={streaming || !draft.trim()} onClick={add}>
            <Plus {...ICON} />
            Add
          </Button>
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------- Swatches

const Swatches = defineComponent({
  name: "Swatches",
  description: 'CSS colours, plain or {value, name}. Click copies the value; with name or value ($var) it also picks one, e.g. Swatches(["#2563EB"], "accent", $accent).',
  props: z.object({
    colors: z.array(z.union([z.string(), z.object({ value: z.string(), name: z.string().optional() })])),
    name: z.string().optional(),
    value: reactive(z.string().optional()),
    label: z.string().optional(),
  }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const field = useStateField(props.name ?? "swatch", props.value);
    const picking = props.name !== undefined || props.value !== undefined;
    const [copied, setCopied] = useState<{ at: number; ok: boolean } | null>(null);
    const labelId = useId();
    useEffect(() => {
      if (!copied) return;
      const timer = setTimeout(() => setCopied(null), 1600);
      return () => clearTimeout(timer);
    }, [copied]);
    const colors = (Array.isArray(props.colors) ? props.colors : []).flatMap((c) =>
      typeof c === "string" ? [{ value: c, name: undefined }] : c && typeof c.value === "string" ? [{ value: c.value, name: str(c.name) }] : [],
    );
    const press = (at: number, value: string) => {
      if (picking) field.setValue(value);
      const write = typeof navigator !== "undefined" ? navigator.clipboard?.writeText(value) : undefined;
      (write ?? Promise.reject(new Error("no clipboard"))).then(
        () => setCopied({ at, ok: true }),
        () => setCopied({ at, ok: false }),
      );
    };
    const status = copied ? (copied.ok ? `Copied ${colors[copied.at]?.value ?? ""}` : "Could not copy. Select the value and copy it by hand.") : "";
    return (
      <div className="bbui bbui-inputs-stack" role="group" aria-labelledby={props.label ? labelId : undefined}>
        {props.label ? (
          <span className="bbui-label" id={labelId}>
            {props.label}
          </span>
        ) : null}
        <ul className="bbui-inputs-palette">
          {colors.map((color, i) => {
            const state = copied?.at === i ? (copied.ok ? "success" : "error") : undefined;
            return (
              <li key={i}>
                <Button
                  className={cx("bbui-inputs-swatch", picking && field.value === color.value && "is-picked")}
                  state={state}
                  aria-pressed={picking ? field.value === color.value : undefined}
                  aria-label={`${color.name ? `${color.name}, ` : ""}${color.value}${picking ? "" : ", copy"}`}
                  disabled={streaming}
                  onClick={() => press(i, color.value)}
                >
                  <span className="bbui-inputs-chip" style={{ backgroundColor: color.value }} />
                  <span className="bbui-inputs-swatch-text">
                    {color.name ? <span>{color.name}</span> : null}
                    <span className="bbui-mono bbui-inputs-swatch-value">{color.value}</span>
                  </span>
                  {state === "success" ? <Check {...ICON} className="bbui-inputs-ok" /> : <Copy {...ICON} className="bbui-inputs-copy" />}
                </Button>
              </li>
            );
          })}
        </ul>
        <span className={cx("bbui-label", copied && !copied.ok ? "bbui-inputs-bad" : "bbui-inputs-sr")} aria-live="polite">
          {status}
        </span>
      </div>
    );
  },
});

// ---------------------------------------------------------------- FollowUps

const FollowUps = defineComponent({
  name: "FollowUps",
  description: "Suggested next questions as a quiet list; a click sends that prompt as the user's next message.",
  props: z.object({ prompts: z.array(z.string()) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const ask = useAsk();
    const [sent, setSent] = useState<number | null>(null);
    const prompts = strings(props.prompts);
    if (prompts.length === 0) return null;
    return (
      <nav className="bbui bbui-inputs-followups" aria-label="Suggested follow-ups">
        <ul>
          {prompts.map((prompt, i) => (
            <li key={i}>
              <Button
                className={cx("bbui-inputs-followup", sent === i && "is-sent")}
                disabled={streaming || sent !== null}
                onClick={() => {
                  setSent(i);
                  ask(prompt);
                }}
              >
                <CornerDownRight {...ICON} />
                <span>{prompt}</span>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    );
  },
});

// ---------------------------------------------------------------- Timer

const Timer = defineComponent({
  name: "Timer",
  description: "A countdown from seconds with start, pause and reset; a stopwatch when seconds is omitted.",
  props: z.object({ seconds: z.number().optional(), label: z.string().optional() }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const total = (num(props.seconds) ?? 0) > 0 ? props.seconds! * 1000 : null;
    const [run, setRun] = useState<{ since: number | null; banked: number }>({ since: null, banked: 0 });
    const [now, setNow] = useState(() => Date.now());
    const elapsed = run.banked + (run.since !== null ? now - run.since : 0);
    const done = total !== null && elapsed >= total;
    useEffect(() => {
      if (run.since === null) return;
      const tick = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(tick);
    }, [run.since]);
    useEffect(() => {
      if (done && run.since !== null) setRun({ since: null, banked: total! });
    }, [done, run.since, total]);
    const running = run.since !== null;
    const toggle = () => {
      const t = Date.now();
      setNow(t);
      setRun((r) => (r.since === null ? { since: t, banked: done ? 0 : r.banked } : { since: null, banked: r.banked + t - r.since }));
    };
    const name = props.label ?? (total !== null ? "Countdown" : "Stopwatch");
    const left = total !== null ? Math.max(0, total - elapsed) / total : 1;
    const status = done ? "Time is up" : running ? "Running" : elapsed > 0 ? "Paused" : "Ready";
    return (
      <div className="bbui bbui-inputs-stack">
        <div className="bbui-inputs-timer-head">
          <span className="bbui-head">{name}</span>
          <span className={cx("bbui-label", done && "bbui-inputs-good")}>{status}</span>
        </div>
        <span className="bbui-figure bbui-inputs-clock" role="timer" aria-label={name}>
          {total !== null ? clock(total - elapsed, true) : clock(elapsed)}
        </span>
        {total !== null ? (
          <span className="bbui-inputs-bar" aria-hidden="true">
            <span className="bbui-inputs-bar-fill bbui-inputs-bar-live" style={{ transform: `scaleX(${left})` }} />
          </span>
        ) : null}
        <div className="bbui-inputs-row">
          <Button variant="primary" disabled={streaming} onClick={toggle}>
            {running ? <Pause {...ICON} /> : <Play {...ICON} />}
            {running ? "Pause" : done ? "Start again" : elapsed > 0 ? "Resume" : "Start"}
          </Button>
          <Button disabled={streaming || elapsed === 0} onClick={() => setRun({ since: null, banked: 0 })}>
            <RotateCcw {...ICON} />
            Reset
          </Button>
        </div>
        <span className="bbui-inputs-sr" aria-live="polite">
          {done ? `${name} finished` : ""}
        </span>
      </div>
    );
  },
});

// ---------------------------------------------------------------- Quiz

const QuizQuestion = defineComponent({
  name: "QuizQuestion",
  description: "One Quiz question: answer is the 0-based index of the right option; why explains it after checking.",
  props: z.object({ q: z.string(), options: z.array(z.string()), answer: z.number(), why: z.string().optional() }),
  component: () => null,
});

const Quiz = defineComponent({
  name: "Quiz",
  description: "A self-check quiz, one question at a time, with the score at the end and a button to send it.",
  props: z.object({ questions: z.array(QuizQuestion.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const ask = useAsk();
    const group = useId();
    const [at, setAt] = useState(0);
    const [picks, setPicks] = useState<(number | null)[]>([]);
    const [checked, setChecked] = useState(false);
    const [sent, setSent] = useState(false);
    const questions = childProps(props.questions).map((p) => ({ q: str(p.q) ?? "", options: strings(p.options), answer: num(p.answer), why: str(p.why) }));
    if (questions.length === 0) return null;
    const answers = questions.map((q) => q.answer);
    const score = quizScore(picks, answers);
    const restart = () => {
      setAt(0);
      setPicks([]);
      setChecked(false);
      setSent(false);
    };

    if (at >= questions.length) {
      const missed = questions.filter((q, i) => picks[i] !== q.answer).map((q) => q.q);
      const message = `My quiz score: ${score} of ${questions.length}.${missed.length ? ` I missed: ${missed.join(" | ")}` : ""}`;
      return (
        <div className="bbui bbui-inputs-stack">
          <span className="bbui-label">Your score</span>
          <span className="bbui-figure">
            {score} of {questions.length}
          </span>
          <div className="bbui-inputs-row">
            <Button
              variant="primary"
              state={sent ? "success" : undefined}
              disabled={streaming || sent}
              onClick={() => {
                setSent(true);
                ask(message);
              }}
            >
              {sent ? <Check {...ICON} /> : null}
              {sent ? "Score sent" : "Send my score"}
            </Button>
            <Button disabled={streaming} onClick={restart}>
              <RotateCcw {...ICON} />
              Try again
            </Button>
          </div>
        </div>
      );
    }

    const question = questions[at]!;
    const pick = picks[at] ?? null;
    const keyed = question.answer !== undefined && question.answer >= 0 && question.answer < question.options.length;
    const right = checked && pick === question.answer;
    return (
      <div className="bbui bbui-inputs-stack">
        <span className="bbui-label">
          Question {at + 1} of {questions.length}
        </span>
        <fieldset className="bbui-inputs-options" disabled={streaming || checked}>
          <legend className="bbui-head">{question.q}</legend>
          {question.options.map((option, i) => {
            const isAnswer = checked && i === question.answer;
            const isWrongPick = checked && i === pick && !isAnswer;
            return (
              <label key={i} className={cx("bbui-inputs-option", pick === i && "is-picked", isAnswer && "is-right", isWrongPick && "is-wrong")}>
                <input
                  type="radio"
                  name={group}
                  checked={pick === i}
                  onChange={() => setPicks((all) => Object.assign([...all], { [at]: i }))}
                />
                <span>{option}</span>
                {isAnswer ? (
                  <span className="bbui-inputs-mark">
                    <Check {...ICON} />
                    Correct answer
                  </span>
                ) : isWrongPick ? (
                  <span className="bbui-inputs-mark">
                    <X {...ICON} />
                    Your answer
                  </span>
                ) : null}
              </label>
            );
          })}
        </fieldset>
        <div aria-live="polite">
          {checked ? (
            <p className="bbui-inputs-feedback">
              <span className={cx("bbui-head", right ? "bbui-inputs-good" : "bbui-inputs-bad")}>
                {!keyed ? "This question has no answer key." : right ? "Correct." : "Not quite."}
              </span>{" "}
              {question.why ?? ""}
            </p>
          ) : null}
        </div>
        <div className="bbui-inputs-row">
          {checked ? (
            <Button
              variant="primary"
              disabled={streaming}
              onClick={() => {
                setAt(at + 1);
                setChecked(false);
              }}
            >
              {at + 1 < questions.length ? "Next question" : "See my score"}
              <ChevronRight {...ICON} />
            </Button>
          ) : (
            <Button variant="primary" disabled={streaming || pick === null} onClick={() => setChecked(true)}>
              Check answer
            </Button>
          )}
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------- Flashcards

const Flashcard = defineComponent({
  name: "Flashcard",
  description: "One card: the prompt on the front, the answer on the back.",
  props: z.object({ front: z.string(), back: z.string() }),
  component: () => null,
});

const Flashcards = defineComponent({
  name: "Flashcards",
  description: "A deck to practise: flip each card, mark it known or again, move back and forth; keeps a tally.",
  props: z.object({ cards: z.array(Flashcard.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const [at, setAt] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [marks, setMarks] = useState<Record<number, "known" | "again">>({});
    const cards = childProps(props.cards).map((p) => ({ front: str(p.front) ?? "", back: str(p.back) ?? "" }));
    if (cards.length === 0) return null;
    const i = Math.min(at, cards.length - 1);
    const card = cards[i]!;
    const go = (to: number) => {
      setAt(Math.max(0, Math.min(cards.length - 1, to)));
      setFlipped(false);
    };
    const mark = (as: "known" | "again") => {
      setMarks((all) => ({ ...all, [i]: as }));
      if (i < cards.length - 1) go(i + 1);
    };
    const tally = Object.values(marks);
    return (
      <div className="bbui bbui-inputs-stack">
        <div className="bbui-inputs-timer-head">
          <span className="bbui-label">
            Card {i + 1} of {cards.length}
          </span>
          <span className="bbui-label">
            Known {tally.filter((m) => m === "known").length}, again {tally.filter((m) => m === "again").length}
          </span>
        </div>
        {/* Keyed by card so moving on never fades the next card's answer into view. */}
        <button key={i} type="button" className="bbui-inputs-card" disabled={streaming} onClick={() => setFlipped(!flipped)}>
          <span className="bbui-inputs-face bbui-head" data-shown={!flipped} aria-hidden={flipped}>
            {card.front}
          </span>
          <span className="bbui-inputs-face" data-shown={flipped} aria-hidden={!flipped}>
            {card.back}
          </span>
          <span className="bbui-label bbui-inputs-hint">{flipped ? "Answer. Click to see the question." : "Click to show the answer."}</span>
        </button>
        <span className="bbui-inputs-sr" aria-live="polite">
          {flipped ? card.back : ""}
        </span>
        <div className="bbui-inputs-row bbui-inputs-spread">
          <Button className="bbui-inputs-icon" aria-label="Previous card" disabled={streaming || i === 0} onClick={() => go(i - 1)}>
            <ChevronLeft {...ICON} />
          </Button>
          <div className="bbui-inputs-row">
            <Button disabled={streaming} state={marks[i] === "again" ? "error" : undefined} onClick={() => mark("again")}>
              Again
            </Button>
            <Button disabled={streaming} state={marks[i] === "known" ? "success" : undefined} onClick={() => mark("known")}>
              Known
            </Button>
          </div>
          <Button className="bbui-inputs-icon" aria-label="Next card" disabled={streaming || i === cards.length - 1} onClick={() => go(i + 1)}>
            <ChevronRight {...ICON} />
          </Button>
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------- Walkthrough

const WalkthroughStep = defineComponent({
  name: "WalkthroughStep",
  description: "One step: body is markdown; code is shown as a highlighted block in language.",
  props: z.object({ title: z.string(), body: z.string(), code: z.string().optional(), language: z.string().optional() }),
  component: () => null,
});

const Walkthrough = defineComponent({
  name: "Walkthrough",
  description: "A guide shown one step at a time with progress and previous/next; for procedures the user follows along.",
  props: z.object({ steps: z.array(WalkthroughStep.ref) }),
  component: ({ props }) => {
    const streaming = useStreaming();
    const [at, setAt] = useState(0);
    const steps = childProps(props.steps).map((p) => ({ title: str(p.title) ?? "", body: str(p.body), code: str(p.code), language: str(p.language) }));
    if (steps.length === 0) return null;
    const i = Math.min(at, steps.length - 1);
    const step = steps[i]!;
    return (
      <section className="bbui bbui-inputs-stack" aria-label="Walkthrough">
        <h3 className="bbui-head bbui-inputs-title">{step.title}</h3>
        {step.body ? <Markdown content={step.body} className="bbui-inputs-md" /> : null}
        {step.code ? <Markdown content={codeFence(step.code, step.language)} className="bbui-inputs-md" /> : null}
        <span className="bbui-inputs-bar" aria-hidden="true">
          <span className="bbui-inputs-bar-fill" style={{ transform: `scaleX(${(i + 1) / steps.length})` }} />
        </span>
        <div className="bbui-inputs-row">
          <Button disabled={streaming || i === 0} onClick={() => setAt(i - 1)}>
            <ChevronLeft {...ICON} />
            Previous
          </Button>
          <span className="bbui-label" aria-live="polite">
            Step {i + 1} of {steps.length}
          </span>
          <Button variant="primary" disabled={streaming || i === steps.length - 1} onClick={() => setAt(i + 1)}>
            Next
            <ChevronRight {...ICON} />
          </Button>
        </div>
      </section>
    );
  },
});

// ---------------------------------------------------------------- Group

const quizExample = `root = Stack([header, quiz])
header = CardHeader("Git undo, quick check", "Two questions")
quiz = Quiz([q1, q2])
q1 = QuizQuestion("Which command undoes a pushed commit without rewriting history?", ["git reset --hard", "git revert", "git checkout"], 1, "revert adds a new commit that inverts the old one, so nobody else's history changes.")
q2 = QuizQuestion("What does git stash pop do?", ["Deletes the latest stash", "Applies the latest stash and drops it", "Lists every stash"], 1)`;

const flashcardsExample = `root = Stack([header, deck])
header = CardHeader("HTTP status codes", "Three cards")
deck = Flashcards([c1, c2, c3])
c1 = Flashcard("401", "Unauthorized: missing or bad credentials")
c2 = Flashcard("403", "Forbidden: credentials are fine, access is not allowed")
c3 = Flashcard("429", "Too many requests: slow down and retry later")`;

const walkthroughExample = `root = Stack([header, guide])
header = CardHeader("Undo a pushed commit", "Without rewriting history")
guide = Walkthrough([s1, s2, s3, s4])
s1 = WalkthroughStep("Find the commit", "List recent commits and copy the hash of the one to undo.", "git log --oneline -5", "bash")
s2 = WalkthroughStep("Revert it", "\`git revert\` adds a **new** commit with the inverse change, so anyone who already pulled stays in sync.", "git revert 3f2a91c", "bash")
s3 = WalkthroughStep("Resolve conflicts if any", "If later commits touched the same lines, fix the files, then continue:", "git add -A\\ngit revert --continue", "bash")
s4 = WalkthroughStep("Push", "Push the revert like any other commit. No force push is needed.", "git push", "bash")`;

export const inputsGroup: ExtraGroup = {
  name: "Inputs and learning",
  notes: [
    'Inputs keep their value in a $var: declare `$guests = 6`, pass it as value (Stepper("guests", $guests)), then use $guests in text, tables or a Button action.',
    "Quiz, Flashcards and Walkthrough take child items (QuizQuestion, Flashcard, WalkthroughStep), one per line.",
  ],
  components: [Stepper, Rating, ListEditor, Swatches, FollowUps, Timer, Quiz, QuizQuestion, Flashcards, Flashcard, Walkthrough, WalkthroughStep],
  examples: {
    Stepper: `root = Stack([header, guests, amounts])
$guests = 6
header = CardHeader("Paella for your group", "Amounts follow the number of guests")
guests = Stepper("guests", $guests, 1, 20, 1, "Guests")
amounts = TextContent("Rice " + $guests * 90 + " g, stock " + $guests * 250 + " ml")`,
    Rating: `root = Stack([header, stars, send])
$stars = 4
header = CardHeader("How useful was this review?")
stars = Rating("stars", $stars, 5, "Your rating")
send = Buttons([Button("Send rating", @ToAssistant("I rate the review " + $stars + " of 5"), "primary")])`,
    ListEditor: `root = Stack([header, labels, apply])
$labels = ["bug", "upload"]
header = CardHeader("Labels for issue 142")
labels = ListEditor("labels", $labels, "Labels", "Add a label")
apply = Buttons([Button("Apply labels", @ToAssistant("Apply these labels to issue 142", $labels), "primary")])`,
    Swatches: `root = Stack([header, accent])
$accent = "#2563EB"
header = CardHeader("Choose an accent", "Click a colour to pick it and copy its value")
accent = Swatches(["#2563EB", {value: "oklch(0.62 0.17 150)", name: "Leaf"}, {value: "rebeccapurple", name: "Purple"}, {value: "#E11D48", name: "Rose"}], "accent", $accent, "Accent colour")`,
    FollowUps: `root = Stack([summary, next])
summary = TextContent("Five days in Lisbon for two comes to about **1,240 EUR**: the flat 610, flights 380 and food 250.")
next = FollowUps(["Where can we save the most?", "Plan the five days hour by hour", "How does Porto compare for the same week?"])`,
    Timer: `root = Stack([header, timer])
header = CardHeader("Focus session", "Phone in another room, one task only")
timer = Timer(1500, "Deep work")`,
    Quiz: quizExample,
    QuizQuestion: quizExample,
    Flashcards: flashcardsExample,
    Flashcard: flashcardsExample,
    Walkthrough: walkthroughExample,
    WalkthroughStep: walkthroughExample,
  },
};
