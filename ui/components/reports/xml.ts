// A tolerant XML reader for JUnit reports: elements, attributes, text and
// CDATA. No namespaces or DTDs; a stray close tag closes back to its match.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const TOKEN =
  /<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?\?>|<![^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Returns a synthetic root whose children are the document's top-level elements. */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  for (const m of source.matchAll(TOKEN)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const at = stack.map((e) => e.name).lastIndexOf(m[2]);
      if (at > 0) stack.length = at;
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      const element: XmlElement = { name: m[3], attrs, children: [], text: "" };
      top.children.push(element);
      if (m[5] !== "/") stack.push(element);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root;
}

/** Every descendant named `name`, in document order, with its ancestors. */
export function findAll(root: XmlElement, name: string): { element: XmlElement; ancestors: XmlElement[] }[] {
  const found: { element: XmlElement; ancestors: XmlElement[] }[] = [];
  const walk = (element: XmlElement, ancestors: XmlElement[]) => {
    for (const child of element.children) {
      if (child.name === name) found.push({ element: child, ancestors });
      walk(child, [...ancestors, child]);
    }
  };
  walk(root, []);
  return found;
}
