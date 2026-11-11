// Pure logic for the Structure and media group: no React, no CSS, so node --test can load it.

export interface TreeNode {
  key: string;
  label: string;
  note?: string;
  /** Came from a path string: drawn in mono. */
  mono: boolean;
  /** null for a leaf. */
  children: TreeNode[] | null;
}

/** Path strings ("src/a.ts", "docs/" for an empty folder) and {label, children?, note?} items into one tree, in the order given. */
export function buildTree(items: unknown, parent = ""): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item === "string") {
      const parts = item.split("/").filter((p) => p !== "");
      const folder = item.endsWith("/");
      let level = roots;
      let key = parent;
      parts.forEach((part, i) => {
        key = `${key}/${part}`;
        const leaf = i === parts.length - 1 && !folder;
        let node = level.find((n) => n.label === part && n.mono && (n.children === null) === leaf);
        if (!node) {
          node = { key, label: part, mono: true, children: leaf ? null : [] };
          level.push(node);
        }
        if (node.children) level = node.children;
      });
    } else if (item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string") {
      const { label, children, note } = item as { label: string; children?: unknown; note?: unknown };
      const key = `${parent}/${label}#${roots.length}`;
      roots.push({
        key,
        label,
        mono: false,
        note: typeof note === "string" && note !== "" ? note : undefined,
        children: Array.isArray(children) ? buildTree(children, key) : null,
      });
    }
  }
  return roots;
}

/** A string that holds JSON becomes its value; anything else is kept. */
export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!/^[[{]/.test(text)) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

/** JSONPath-style text for a path: $.data.lines[0]["request id"]. */
export function jsonPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>(
    (path, s) => (typeof s === "number" ? `${path}[${s}]` : /^[A-Za-z_$][\w$]*$/.test(s) ? `${path}.${s}` : `${path}[${JSON.stringify(s)}]`),
    "$",
  );
}

export type JsonKind = "string" | "number" | "boolean" | "null" | "array" | "object";
export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean" ? type : type === "object" ? "object" : "string";
}

/** "3 items" / "1 key", for a folded array or object. */
export function jsonSummary(value: unknown): string {
  const kind = jsonKind(value);
  if (kind === "array") {
    const n = (value as unknown[]).length;
    return `${n} ${n === 1 ? "item" : "items"}`;
  }
  const n = Object.keys(value as object).length;
  return `${n} ${n === 1 ? "key" : "keys"}`;
}

/** What Copy value writes: a string as itself, everything else as JSON. */
export function jsonCopyText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2) ?? String(value);
}

const EXTENSIONS: Record<string, string> = {
  typescript: "ts", tsx: "tsx", javascript: "js", jsx: "jsx", python: "py", ruby: "rb", rust: "rs", golang: "go", kotlin: "kt",
  swift: "swift", java: "java", csharp: "cs", "c#": "cs", "c++": "cpp", cpp: "cpp", shell: "sh", bash: "sh", markdown: "md", yaml: "yml",
};

/** The file a single-file patch applies to, from its headers, else a name that carries the language. */
export function diffPath(patch: string, language?: string): string {
  for (const pattern of [/^\+\+\+ (?:b\/)?([^\t\r\n]+)/m, /^--- (?:a\/)?([^\t\r\n]+)/m, /^diff --git a\/\S+ b\/(\S+)/m]) {
    const found = pattern.exec(patch)?.[1]?.trim();
    if (found && found !== "/dev/null") return found;
  }
  const lang = (language ?? "").trim().toLowerCase();
  return `file.${EXTENSIONS[lang] ?? (/^[a-z0-9+#]{1,12}$/.test(lang) ? lang : "txt")}`;
}

/** Lines added and removed, headers excluded. */
export function diffStats(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** An http(s) URL to open, or null: the only links these components follow. */
export function webUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** example.com for https://www.example.com/a. */
export const domainOf = (url: URL) => url.hostname.replace(/^www\./, "");

/** example.com/a/b, for a link with no title. */
export const shortUrl = (url: URL) => `${domainOf(url)}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;

/** An image source: an https URL used as is, a thread file path read through the server, or null (other schemes, empty). */
export function imageSource(src: unknown): { kind: "url"; url: string } | { kind: "file"; path: string } | null {
  if (typeof src !== "string" || src.trim() === "") return null;
  const text = src.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return webUrl(text)?.protocol === "https:" ? { kind: "url", url: text } : null;
  return { kind: "file", path: text };
}

/** A percentage kept inside the image; NaN and missing become the centre. */
export const percent = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50);
