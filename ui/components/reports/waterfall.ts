// Timings on one axis: inline spans [{name, start, duration, depth?}] in a
// given unit, or a HAR file (requests, in ms from the first). Pure.
import { epoch, isObj, num, str, tryJson } from "./common";

export interface Span {
  name: string;
  start: number;
  duration: number;
  depth: number;
  /** HAR: method and status, "GET 200". */
  detail?: string;
  /** HAR: a 4xx/5xx or failed request. */
  failed?: boolean;
}
export interface Timeline {
  spans: Span[];
  /** The earliest start, so the axis can begin there. */
  begin: number;
  end: number;
  unit: string;
}

const USAGE = "Waterfall reads [{name, start, duration, depth?}] or a HAR file";

export function parseWaterfall(input: string | unknown[], unit = "ms"): Timeline {
  const json = Array.isArray(input) ? input : tryJson(input.trim());
  let spans: Span[];
  if (Array.isArray(json)) spans = fromSpans(json);
  else if (isObj(json) && isObj(json.log) && Array.isArray(json.log.entries)) {
    spans = fromHar(json.log.entries);
    unit = "ms";
  } else throw new Error(USAGE);
  const begin = spans.length ? Math.min(...spans.map((s) => s.start)) : 0;
  const end = spans.length ? Math.max(...spans.map((s) => s.start + s.duration)) : 0;
  return { spans, begin, end, unit };
}

function fromSpans(rows: unknown[]): Span[] {
  return rows.filter(isObj).flatMap((row) => {
    const name = str(row.name);
    const start = num(row.start);
    const duration = num(row.duration);
    if (!name || start === undefined || duration === undefined || duration < 0) return [];
    return [{ name, start, duration, depth: Math.max(0, Math.min(6, Math.round(num(row.depth) ?? 0))) }];
  });
}

/** Host and path, so rows read "cdn.example.com/app.js" rather than a full URL. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function fromHar(entries: unknown[]): Span[] {
  const timed = entries.filter(isObj).flatMap((e) => {
    const at = epoch(e.startedDateTime);
    const time = num(e.time);
    const request = isObj(e.request) ? e.request : {};
    const response = isObj(e.response) ? e.response : {};
    if (at === undefined || time === undefined) return [];
    const status = num(response.status);
    const method = str(request.method) ?? "GET";
    return [
      {
        name: shortUrl(str(request.url) ?? "request"),
        at,
        duration: Math.max(0, time),
        detail: status ? `${method} ${status}` : `${method}, no response`,
        failed: !status || status >= 400,
      },
    ];
  });
  const first = Math.min(...timed.map((t) => t.at));
  return timed.map(({ at, ...span }) => ({ ...span, start: at - first, depth: 0 })).sort((a, b) => a.start - b.start);
}

