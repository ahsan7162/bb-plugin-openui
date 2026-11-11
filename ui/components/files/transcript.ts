// What Transcript compares: tracks read into words (plain text, or a JSON
// list of {text, start, end, speaker?}), each hypothesis aligned word by word
// to the reference with a Levenshtein alignment, and its word error rate.
// Pure: no React, no DOM.

export interface Word {
  text: string;
  start?: number;
  end?: number;
  speaker?: string;
}

export type OpKind = "match" | "sub" | "del" | "ins";
/** One alignment step: indexes into the reference (`r`) and hypothesis (`h`) words. */
export interface Op {
  kind: OpKind;
  r?: number;
  h?: number;
}
export interface Score {
  sub: number;
  del: number;
  ins: number;
  /** Reference words. */
  words: number;
  /** (sub + del + ins) / words; 0 for an empty reference and hypothesis. */
  wer: number;
}

/** Cells one alignment table may hold (about 16 MB). */
export const MAX_CELLS = 4_000_000;

export function wordsFromText(text: string): Word[] {
  return text.split(/\s+/).filter(Boolean).map((t) => ({ text: t }));
}

function readWord(value: unknown, speaker?: string): Word | null {
  if (typeof value === "string") return { text: value };
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const text = typeof v.text === "string" ? v.text : typeof v.word === "string" ? v.word : typeof v.punctuated_word === "string" ? v.punctuated_word : null;
  if (text === null || text.trim() === "") return null;
  const word: Word = { text: text.trim() };
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const start = num(v.start);
  const end = num(v.end);
  if (start !== undefined) word.start = start;
  if (end !== undefined) word.end = end;
  const who = v.speaker ?? speaker;
  if (typeof who === "string" || typeof who === "number") word.speaker = String(who);
  return word;
}

/** Words from a JSON transcript: a list of words, `{words: [...]}`, or `{segments: [{words?, text, speaker?}]}`. */
export function wordsFromJson(text: string): Word[] {
  const value: unknown = JSON.parse(text);
  const list = (items: unknown, speaker?: string) => (Array.isArray(items) ? items.map((w) => readWord(w, speaker)).filter((w): w is Word => w !== null) : []);
  if (Array.isArray(value)) return list(value);
  if (typeof value !== "object" || value === null) throw new Error("expected a list of words or an object with words or segments");
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.words)) return list(v.words);
  if (Array.isArray(v.segments)) {
    return v.segments.flatMap((segment: unknown) => {
      if (typeof segment !== "object" || segment === null) return [];
      const s = segment as Record<string, unknown>;
      const speaker = typeof s.speaker === "string" ? s.speaker : undefined;
      if (Array.isArray(s.words)) return list(s.words, speaker);
      return typeof s.text === "string" ? wordsFromText(s.text).map((w) => (speaker ? { ...w, speaker } : w)) : [];
    });
  }
  throw new Error("expected a list of words or an object with words or segments");
}

/** A word as compared: lower case, punctuation gone (apostrophes inside a word kept). */
export function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "")
    .replace(/^'+|'+$/g, "");
}

/** Minimum-edit alignment of hypothesis to reference (substitution, deletion, insertion all cost 1). */
export function align(ref: readonly string[], hyp: readonly string[]): Op[] {
  const n = ref.length;
  const m = hyp.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    // shortcut: plain O(n*m) table; band or anchor-split it if hour-long transcripts are needed.
    throw new Error(`${n} by ${m} words is too long to align here; compare shorter excerpts`);
  }
  const w = m + 1;
  const d = new Uint32Array((n + 1) * w);
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    d[i * w] = i;
    for (let j = 1; j <= m; j++) {
      const diag = d[(i - 1) * w + j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      d[i * w + j] = Math.min(diag, d[(i - 1) * w + j]! + 1, d[i * w + j - 1]! + 1);
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = d[i * w + j]!;
    if (i > 0 && j > 0 && here === d[(i - 1) * w + j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ kind: ref[i - 1] === hyp[j - 1] ? "match" : "sub", r: --i, h: --j });
    } else if (i > 0 && here === d[(i - 1) * w + j]! + 1) {
      ops.push({ kind: "del", r: --i });
    } else {
      ops.push({ kind: "ins", h: --j });
    }
  }
  return ops.reverse();
}

export function score(ops: readonly Op[], words: number): Score {
  const count = (kind: OpKind) => ops.filter((o) => o.kind === kind).length;
  const s = { sub: count("sub"), del: count("del"), ins: count("ins"), words };
  const errors = s.sub + s.del + s.ins;
  return { ...s, wer: words === 0 ? (errors === 0 ? 0 : 1) : errors / words };
}

/** Aligns two word lists after normalising; words that normalise to nothing are left out of both. */
export function compare(ref: readonly Word[], hyp: readonly Word[]): { ref: Word[]; hyp: Word[]; ops: Op[]; score: Score } {
  const keep = (words: readonly Word[]) => words.filter((w) => normalize(w.text) !== "");
  const r = keep(ref);
  const h = keep(hyp);
  const ops = align(r.map((w) => normalize(w.text)), h.map((w) => normalize(w.text)));
  return { ref: r, hyp: h, ops, score: score(ops, r.length) };
}
