// An image's pixel size read from the head of its data URL, so FileImage can
// reserve the box before the browser decodes it. PNG, GIF, JPEG, WebP and SVG.
// Pure: no React, no DOM.

export interface Size {
  width: number;
  height: number;
}

/** The bytes of a data URL's first `limit` decoded bytes (base64 or URL-encoded). */
function head(dataUrl: string, limit: number): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  let text: string;
  try {
    text = meta.endsWith(";base64") ? atob(body.slice(0, Math.ceil((limit * 4) / 3 / 4) * 4)) : decodeURIComponent(body.slice(0, limit));
  } catch {
    return null;
  }
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

function svgSize(text: string): Size | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, "i").exec(tag)?.[1];
  const width = Number(attr("width"));
  const height = Number(attr("height"));
  if (width > 0 && height > 0) return { width, height };
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null;
}

/** The pixel size an image data URL declares; null when it cannot be read from its head. */
export function imageSize(dataUrl: string): Size | null {
  const b = head(dataUrl, 64 * 1024);
  if (b === null || b.length < 10) return null;
  const ok = (size: Size) => (size.width > 0 && size.height > 0 ? size : null);
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b.length >= 24) return ok({ width: be32(b, 16), height: be32(b, 20) });
  if (ascii(b, 0, 3) === "GIF") return ok({ width: le16(b, 6), height: le16(b, 8) });
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return ok({ width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff });
    if (chunk === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return ok({ width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
    }
    if (chunk === "VP8X") return ok({ width: le24(b, 24) + 1, height: le24(b, 27) + 1 });
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame (SOF0-15, not DHT/JPG/DAC).
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok({ width: be16(b, i + 7), height: be16(b, i + 5) });
      }
      i += 2 + be16(b, i + 2);
    }
    return null;
  }
  const text = new TextDecoder().decode(b);
  return /<svg\b/i.test(text) ? svgSize(text) : null;
}
