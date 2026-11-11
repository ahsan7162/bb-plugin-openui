// Shared pieces every component group uses: the loading, empty and error
// states, the button, number formatting and sending a message to the agent.
// Styles and tokens are in kit.css (see DESIGN.md); CSS is loaded by styles.css, never imported here.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useIsStreaming, useTriggerAction } from "@openuidev/react-lang";
import type { Loaded } from "../data";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** A skeleton in the rough shape of what is coming: `lines` bars, the last one shorter. */
export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="bbui-skeleton" role="status" aria-label="Loading">
      {height !== undefined ? (
        <span style={{ height }} />
      ) : (
        Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: i === lines - 1 ? "60%" : "100%" }} />)
      )}
    </div>
  );
}

/** What is empty and how to fill it. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="bbui-empty">
      <span className="bbui-head">{title}</span>
      {hint ? <span className="bbui-label">{hint}</span> : null}
    </div>
  );
}

/** What broke and what to do. */
export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="bbui-error" role="alert">
      <span className="bbui-head">{title}</span>
      {detail ? <span className="bbui-label">{detail}</span> : null}
    </div>
  );
}

/**
 * Draws the four states of a region that loads data. `parse` turns the file's
 * text into the value (throw to report a parse error); `isEmpty` decides empty.
 */
export function LoadedView<T>({
  loaded,
  parse,
  isEmpty,
  empty,
  errorTitle = "This file could not be shown",
  skeleton,
  children,
}: {
  loaded: Loaded<string>;
  parse: (text: string) => T;
  isEmpty?: (value: T) => boolean;
  empty: { title: string; hint?: string };
  errorTitle?: string;
  skeleton?: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (loaded.state === "loading") return <>{skeleton ?? <Skeleton />}</>;
  if (loaded.state === "error") return <ErrorState title={errorTitle} detail={loaded.error} />;
  let value: T;
  try {
    value = parse(loaded.value);
  } catch (cause) {
    return <ErrorState title={errorTitle} detail={cause instanceof Error ? cause.message : String(cause)} />;
  }
  if (isEmpty?.(value)) return <EmptyState {...empty} />;
  return <>{children(value)}</>;
}

export function Button({
  variant,
  state,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary"; state?: "loading" | "error" | "success" }) {
  return <button type={type} className={cx("bbui-btn", className)} data-variant={variant} data-state={state} {...rest} />;
}

/** Sends text to the agent as the user's next message (OpenUI's continue_conversation). */
export function useAsk(): (text: string) => void {
  const trigger = useTriggerAction();
  return (text) => void trigger(text);
}

/** True while the reply is still streaming: hold interactions and chart drawing until it ends. */
export const useStreaming = useIsStreaming;

const formatters = new Map<string, Intl.NumberFormat>();
/** Locale number formatting with tabular-friendly output; `compact` gives 12.4K. */
export function fmt(value: number, { decimals, compact = false, unit }: { decimals?: number; compact?: boolean; unit?: string } = {}): string {
  if (!Number.isFinite(value)) return "-";
  const key = `${decimals}|${compact}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: decimals ?? (Math.abs(value) < 10 ? 2 : Math.abs(value) < 1000 ? 1 : 0),
      minimumFractionDigits: decimals ?? 0,
    });
    formatters.set(key, format);
  }
  const text = format.format(value);
  return unit ? `${text} ${unit}` : text;
}

/** Clamp to [min, max]. */
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Tone colours by meaning; never decorative. */
export const TONES = {
  neutral: "var(--bbui-muted)",
  accent: "var(--bbui-accent)",
  good: "var(--bbui-success)",
  warn: "var(--bbui-warning)",
  bad: "var(--bbui-danger)",
  info: "var(--bbui-accent)",
} as const;
export type Tone = keyof typeof TONES;
