// Outdated packages and vulnerabilities from npm outdated --json, npm audit
// --json (v1 and v2), pip list --outdated --format json, or an inline list
// [{name, current, latest}]. Pure.
import { isObj, list, str, tryJson, type Obj } from "./common";

export type Gap = "major" | "minor" | "patch" | "none" | "missing";
export interface Dependency {
  name: string;
  current?: string;
  wanted?: string;
  latest?: string;
  gap: Gap;
  type?: string;
}
export const VULN_LEVELS = ["critical", "high", "moderate", "low", "info"] as const;
export type VulnLevel = (typeof VULN_LEVELS)[number];
export interface Vulnerability {
  name: string;
  severity: VulnLevel;
  title?: string;
  url?: string;
  range?: string;
  fix?: string;
  direct?: boolean;
}
export interface DependencyReport {
  /** Largest gap first. */
  outdated: Dependency[];
  /** Most severe first. */
  vulnerabilities: Vulnerability[];
}

const USAGE = "Dependencies reads npm outdated or npm audit --json, pip list --outdated --format json, or [{name, current, latest}]";

const parts = (version: string | undefined) => {
  const m = version ? /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version) : null;
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
};

/** How far `current` is behind `latest`. Under 1.0, a minor bump breaks like a major one (semver). */
export function gap(current: string | undefined, latest: string | undefined): Gap {
  if (!current) return "missing";
  const a = parts(current);
  const b = parts(latest);
  if (!a || !b) return current === latest ? "none" : "patch";
  if (b[0]! > a[0]!) return "major";
  if (b[0] === a[0] && b[1]! > a[1]!) return a[0] === 0 ? "major" : "minor";
  if (b[0] === a[0] && b[1] === a[1] && b[2]! > a[2]!) return "patch";
  return "none";
}

const GAP_RANK: Record<Gap, number> = { missing: 0, major: 1, minor: 2, patch: 3, none: 4 };

export function parseDependencies(input: string | unknown[]): DependencyReport {
  let outdated: Dependency[] = [];
  let vulnerabilities: Vulnerability[] = [];
  const json = Array.isArray(input) ? input : input.trim() === "" ? {} : tryJson(input.trim());
  if (Array.isArray(json)) outdated = fromList(json);
  else if (isObj(json)) {
    if (isObj(json.vulnerabilities)) vulnerabilities = fromAuditV2(json.vulnerabilities);
    else if (isObj(json.advisories)) vulnerabilities = fromAuditV1(json.advisories);
    else if (!("auditReportVersion" in json) && !("metadata" in json)) outdated = fromNpmOutdated(json);
  } else throw new Error(USAGE);
  outdated.sort((a, b) => GAP_RANK[a.gap] - GAP_RANK[b.gap] || a.name.localeCompare(b.name));
  vulnerabilities.sort((a, b) => VULN_LEVELS.indexOf(a.severity) - VULN_LEVELS.indexOf(b.severity) || a.name.localeCompare(b.name));
  return { outdated: outdated.filter((d) => d.gap !== "none"), vulnerabilities };
}

/** pip (`version`, `latest_version`) or inline (`current`, `latest`). */
function fromList(rows: unknown[]): Dependency[] {
  return rows.filter(isObj).flatMap((row) => {
    const name = str(row.name);
    if (!name) return [];
    const current = str(row.current) ?? str(row.version);
    const latest = str(row.latest) ?? str(row.latest_version);
    return [{ name, current, latest, gap: gap(current, latest), type: str(row.type) }];
  });
}

function fromNpmOutdated(json: Obj): Dependency[] {
  const entries = Object.entries(json);
  if (entries.length > 0 && !entries.every(([, v]) => isObj(v) || Array.isArray(v))) throw new Error(USAGE);
  // npm 7+ gives an array per name when several workspaces depend on it; take the first.
  return entries.flatMap(([name, value]) => {
    const v = Array.isArray(value) ? value.find(isObj) : value;
    if (!isObj(v) || !("latest" in v || "wanted" in v)) return [];
    const current = str(v.current);
    const latest = str(v.latest);
    return [{ name, current, wanted: str(v.wanted), latest, gap: gap(current, latest), type: str(v.type) }];
  });
}

const level = (value: unknown): VulnLevel => {
  const s = String(value ?? "").toLowerCase();
  return (VULN_LEVELS as readonly string[]).includes(s) ? (s as VulnLevel) : s === "medium" ? "moderate" : "info";
};

function fromAuditV2(vulns: Obj): Vulnerability[] {
  return Object.entries(vulns).flatMap(([key, v]) => {
    if (!isObj(v)) return [];
    const advisory = list(v.via).find(isObj);
    const via = list(v.via).filter((x): x is string => typeof x === "string");
    const fixAvailable = v.fixAvailable;
    const fix = isObj(fixAvailable)
      ? `${str(fixAvailable.name) ?? key} ${str(fixAvailable.version) ?? ""}${fixAvailable.isSemVerMajor ? " (major)" : ""}`.trim()
      : fixAvailable === true
        ? "npm audit fix"
        : undefined;
    return [
      {
        name: str(v.name) ?? key,
        severity: level(v.severity),
        title: str(advisory?.title) ?? (via.length ? `Through ${via.join(", ")}` : undefined),
        url: str(advisory?.url),
        range: str(v.range),
        fix,
        direct: typeof v.isDirect === "boolean" ? v.isDirect : undefined,
      },
    ];
  });
}

function fromAuditV1(advisories: Obj): Vulnerability[] {
  return Object.values(advisories)
    .filter(isObj)
    .map((a) => ({
      name: str(a.module_name) ?? "package",
      severity: level(a.severity),
      title: str(a.title),
      url: str(a.url),
      range: str(a.vulnerable_versions),
      fix: str(a.patched_versions) ? `Patched in ${a.patched_versions}` : undefined,
    }));
}
