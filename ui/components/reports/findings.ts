// Lint, type and review findings from eslint, biome, oxlint or ruff JSON,
// SARIF, `tsc --pretty false` text, or an inline list
// [{severity, title, file?, line?, detail?, fix?, status?}]. Pure.
import { isObj, list, num, shortenPaths, str, stripAnsi, tryJson, type Obj } from "./common";

export type Severity = "error" | "warning" | "info";
export interface Finding {
  severity: Severity;
  title: string;
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  detail?: string;
  fix?: string;
  status?: string;
}
export interface FileGroup {
  file: string | undefined;
  findings: Finding[];
}
export interface FindingsReport {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** Grouped by file: files with errors first, then by count; findings by line. */
  files: FileGroup[];
}

const USAGE = "Findings reads eslint, biome, oxlint or ruff JSON, SARIF, tsc --pretty false output, or [{severity, title, file?, line?}]";

export function severity(value: unknown): Severity {
  if (value === 2) return "error";
  if (value === 1) return "warning";
  const s = String(value ?? "").toLowerCase();
  if (/^(error|fatal|critical|high|blocker|major|deny|p0|p1)$/.test(s)) return "error";
  if (/^(warning|warn|medium|moderate|minor|p2)$/.test(s)) return "warning";
  return "info";
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function parseFindings(input: string | unknown[]): FindingsReport {
  const findings = Array.isArray(input) ? fromArray(input) : fromText(input);
  const short = shortenPaths(findings.flatMap((f) => (f.file ? [f.file] : [])));
  for (const f of findings) if (f.file) f.file = short(f.file);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const byFile = new Map<string | undefined, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const worst = (g: Finding[]) => Math.min(...g.map((f) => RANK[f.severity]));
  const files = [...byFile]
    .map(([file, group]) => ({ file, findings: group.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || RANK[a.severity] - RANK[b.severity]) }))
    .sort((a, b) => worst(a.findings) - worst(b.findings) || b.findings.length - a.findings.length || (a.file ?? "").localeCompare(b.file ?? ""));
  return { findings, counts, files };
}

function fromText(text: string): Finding[] {
  const trimmed = stripAnsi(text).trim();
  if (trimmed === "") return [];
  const json = tryJson(trimmed);
  if (Array.isArray(json)) return fromArray(json);
  if (isObj(json)) {
    if (Array.isArray(json.runs)) return fromSarif(json.runs);
    if (Array.isArray(json.findings)) return fromArray(json.findings); // a review written as {findings: [...]}
    if (Array.isArray(json.diagnostics)) return json.diagnostics.filter(isObj).map((d) => ("filename" in d ? fromOxlint(d) : fromBiome(d)));
    throw new Error(USAGE);
  }
  const tsc = fromTsc(trimmed);
  if (tsc.length > 0 || /^Found 0 errors/m.test(trimmed)) return tsc;
  throw new Error(USAGE);
}

/** eslint (files with messages), ruff (flat with location.row), or inline rows. */
function fromArray(rows: unknown[]): Finding[] {
  return rows.filter(isObj).flatMap((row): Finding[] => {
    if (Array.isArray(row.messages)) {
      const file = str(row.filePath);
      return row.messages.filter(isObj).map((m) => ({
        severity: m.fatal ? "error" : severity(m.severity),
        title: str(m.message) ?? "Problem",
        file,
        line: num(m.line),
        column: num(m.column),
        rule: str(m.ruleId),
        fix: m.fix ? "Autofix available (eslint --fix)" : list(m.suggestions).length ? str((list(m.suggestions)[0] as Obj).desc) : undefined,
      }));
    }
    if (str(row.filename) && isObj(row.location)) {
      return [
        {
          // Ruff reports every violation as an error unless told otherwise; keep its word when it has one.
          severity: row.severity === undefined ? "warning" : severity(row.severity),
          title: str(row.message) ?? "Problem",
          file: str(row.filename),
          line: num(row.location.row),
          column: num(row.location.column),
          rule: str(row.code) ?? str(row.name),
          fix: isObj(row.fix) ? str(row.fix.message) ?? "Autofix available (ruff --fix)" : undefined,
        },
      ];
    }
    const title = str(row.title) ?? str(row.issue) ?? str(row.message);
    if (!title) return [];
    return [
      {
        severity: severity(row.severity),
        title,
        file: str(row.file),
        line: num(row.line),
        rule: str(row.rule),
        detail: str(row.detail) ?? str(row.evidence),
        fix: str(row.fix),
        status: str(row.status),
      },
    ];
  });
}

function fromBiome(d: Obj): Finding {
  const location = isObj(d.location) ? d.location : {};
  const path = isObj(location.path) ? str(location.path.file) : str(location.path);
  const start = isObj(location.start) ? location.start : undefined;
  const fix = list(d.advices).filter(isObj).map((a) => str(a.text)).find((t) => t && /fix/i.test(t));
  return {
    severity: severity(d.severity === "information" || d.severity === "hint" ? "info" : d.severity),
    title: str(d.message) ?? str(d.description) ?? "Problem",
    file: path,
    line: start ? num(start.line) : undefined,
    column: start ? num(start.column) : undefined,
    rule: str(d.category),
    fix,
  };
}

function fromOxlint(d: Obj): Finding {
  const span = list(d.labels).filter(isObj).map((l) => (isObj(l.span) ? l.span : {}))[0];
  return {
    severity: severity(d.severity),
    title: str(d.message) ?? "Problem",
    file: str(d.filename),
    line: span ? num(span.line) : undefined,
    column: span ? num(span.column) : undefined,
    rule: str(d.code),
    fix: str(d.help),
  };
}

function fromSarif(runs: unknown[]): Finding[] {
  return runs.filter(isObj).flatMap((run) =>
    list(run.results)
      .filter(isObj)
      .map((r): Finding => {
        const physical = list(r.locations).filter(isObj).map((l) => (isObj(l.physicalLocation) ? l.physicalLocation : {}))[0] ?? {};
        const artifact = isObj(physical.artifactLocation) ? physical.artifactLocation : {};
        const region = isObj(physical.region) ? physical.region : {};
        const message = isObj(r.message) ? str(r.message.text) ?? str(r.message.markdown) : undefined;
        return {
          // SARIF: error, warning, note, none; a missing level means warning.
          severity: r.level === undefined ? "warning" : r.level === "note" || r.level === "none" ? "info" : severity(r.level),
          title: message ?? str(r.ruleId) ?? "Problem",
          file: str(artifact.uri),
          line: num(region.startLine),
          column: num(region.startColumn),
          rule: str(r.ruleId),
          fix: list(r.fixes).filter(isObj).map((f) => (isObj(f.description) ? str(f.description.text) : undefined))[0],
        };
      }),
  );
}

const TSC = /^(.+?)[(:](\d+)[,:](\d+)\)?:?\s+-?\s*(error|warning|message)\s+(TS\d+):\s*(.*)$/;
const TSC_GLOBAL = /^(error|warning)\s+(TS\d+):\s*(.*)$/;

/** `file(line,col): error TS1234: message`, indented lines continue the previous one. */
function fromTsc(text: string): Finding[] {
  const found: Finding[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = TSC.exec(raw.trim());
    const g = m ? null : TSC_GLOBAL.exec(raw.trim());
    if (m) found.push({ severity: severity(m[4]), title: m[6]!, file: m[1], line: Number(m[2]), column: Number(m[3]), rule: m[5] });
    else if (g) found.push({ severity: severity(g[1]), title: g[3]!, rule: g[2] });
    else if (/^\s+\S/.test(raw) && found.length > 0) {
      const last = found[found.length - 1]!;
      last.detail = last.detail ? `${last.detail}\n${raw.trim()}` : raw.trim();
    }
  }
  return found;
}
