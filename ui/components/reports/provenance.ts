// Provenance: stages from source to live, each with facts (branch, sha,
// build, device...). Flags a fact that differs from what was expected or
// from the last stage that reported it. Pure.
import { isObj, str } from "./common";

export type StageStatus = "done" | "running" | "pending" | "failed" | "skipped";
export interface Fact {
  key: string;
  value: string;
  /** Set when the value differs from `expected[key]`. */
  expected?: string;
  /** Set when the value differs from the previous stage's; that stage's name and value. */
  changed?: { stage: string; value: string };
}
export interface Stage {
  name: string;
  status: StageStatus;
  detail?: string;
  facts: Fact[];
}
export interface ProvenanceReport {
  stages: Stage[];
  /** Facts that drift, in stage order. */
  drift: { stage: string; fact: Fact }[];
}

export function stageStatus(value: unknown): StageStatus {
  const s = String(value ?? "").toLowerCase();
  if (/^(done|success|passed|ok|complete|completed|live)$/.test(s)) return "done";
  if (/^(running|in_progress|active|deploying)$/.test(s)) return "running";
  if (/^(failed|failure|error)$/.test(s)) return "failed";
  if (/^(skipped|cancelled|canceled)$/.test(s)) return "skipped";
  return "pending";
}

const HASH = /^[0-9a-f]{7,64}$/i;
/** Same value: case-insensitive, and a short hash matches the full one it starts. */
export function sameFact(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;
  return HASH.test(x) && HASH.test(y) && (x.startsWith(y) || y.startsWith(x));
}

const text = (value: unknown) => (typeof value === "number" || typeof value === "boolean" ? String(value) : str(value));

export function parseProvenance(stages: unknown, expected?: unknown): ProvenanceReport {
  const want = isObj(expected) ? expected : {};
  const last = new Map<string, { stage: string; value: string }>();
  const drift: ProvenanceReport["drift"] = [];
  const result = (Array.isArray(stages) ? stages : []).filter(isObj).flatMap((row): Stage[] => {
    const name = str(row.name);
    if (!name) return [];
    const facts = Object.entries(isObj(row.facts) ? row.facts : {}).flatMap(([key, raw]): Fact[] => {
      const value = text(raw);
      if (value === undefined) return [];
      const fact: Fact = { key, value };
      const wanted = text(want[key]);
      if (wanted !== undefined && !sameFact(value, wanted)) fact.expected = wanted;
      const before = last.get(key);
      if (before && !sameFact(value, before.value)) fact.changed = before;
      last.set(key, { stage: name, value });
      // A wrong value carried unchanged through later stages is reported once, where it first appears.
      if (fact.changed || (fact.expected && !(before && sameFact(value, before.value)))) drift.push({ stage: name, fact });
      return [fact];
    });
    return [{ name, status: stageStatus(row.status), detail: str(row.detail), facts }];
  });
  return { stages: result, drift };
}
