// Web lookups for Map and ImageSearch: place names to coordinates (Photon),
// map tiles (OpenStreetMap), photo search and Wikipedia lead photos
// (Wikimedia Commons). Everything is fetched here, in the BB server, and sent
// to the page as data URLs, so the `webLookups` setting is a real switch and
// the page never contacts these hosts. Only fixed https hosts are reachable,
// requests time out and bodies are capped; answers are cached in memory.
// Failures are values, never throws.
import { z } from "zod";

export const WEB_SETTING = {
  webLookups: {
    type: "boolean",
    label: "Web lookups",
    description:
      "Lets Map and ImageSearch blocks fetch from the web, through this BB server. Map sends place names that come without coordinates to Photon (photon.komoot.io) and loads map tiles from OpenStreetMap (tile.openstreetmap.org). ImageSearch sends its search words to Wikimedia Commons (commons.wikimedia.org); Map sends the Wikipedia article names of its places to Wikipedia (en.wikipedia.org) and Commons; the photos load from upload.wikimedia.org. These services see this machine's IP address and the request itself, with a User-Agent naming this plugin; no cookies, chat text or account details are sent. Answers are kept in memory until the plugin restarts. Off: nothing is fetched and those blocks say so.",
    default: true,
  },
} as const;

/** Names the plugin, as the services' usage policies ask; nothing about the user. */
export const USER_AGENT = "bb-plugin-openui/0.1 (OpenUI inline UI plugin for BB)";
export const ALLOWED_HOSTS = new Set(["photon.komoot.io", "tile.openstreetmap.org", "commons.wikimedia.org", "en.wikipedia.org", "upload.wikimedia.org"]);
export const MAX_TILE_ZOOM = 19;
const DAY = 86_400_000;
const PHOTON_SPACING_MS = 1_100;

// Inputs and outputs of the RPC methods (server.ts registers them).
const failure = z.object({ ok: z.literal(false), error: z.string(), off: z.boolean().optional() });
const photo = z.object({
  src: z.string(),
  width: z.number(),
  height: z.number(),
  title: z.string(),
  artist: z.string(),
  licence: z.string(),
  licenceUrl: z.string().nullable(),
  pageUrl: z.string(),
});
export type WebPhoto = z.infer<typeof photo>;
export type WebFailure = z.infer<typeof failure>;
export const webMethods = {
  web_geocode: {
    input: z.object({ name: z.string().min(1).max(200), nearLat: z.number().min(-90).max(90).optional(), nearLng: z.number().min(-180).max(180).optional() }),
    output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), lat: z.number(), lng: z.number() }), failure]),
  },
  web_tile: {
    input: z.object({ z: z.number().int().min(0).max(MAX_TILE_ZOOM), x: z.number().int().min(0), y: z.number().int().min(0) }),
    output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), dataUrl: z.string() }), failure]),
  },
  web_image_search: {
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), photo }), failure]),
  },
  web_wiki_photo: {
    input: z.object({ title: z.string().min(1).max(300) }),
    output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), photo }), failure]),
  },
};

type Got = { ok: true; body: Buffer; type: string } | WebFailure;
export type Fetcher = typeof fetch;

/** GET an https URL on an allowed host: no redirects, a deadline, a byte cap. */
export async function get(url: string, { accept, maxBytes, timeoutMs }: { accept: string; maxBytes: number; timeoutMs: number }, fetcher: Fetcher = fetch): Promise<Got> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "not a valid URL" };
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.port !== "" || parsed.username !== "") {
    return { ok: false, error: `${parsed.hostname} is not one of the hosts web lookups use` };
  }
  try {
    const response = await fetcher(parsed.href, {
      headers: { "user-agent": USER_AGENT, accept },
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return { ok: false, error: `${parsed.hostname} answered ${response.status}` };
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await response.body?.cancel();
      return { ok: false, error: `${parsed.hostname} sent more than ${maxBytes} bytes` };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader!.cancel();
        return { ok: false, error: `${parsed.hostname} sent more than ${maxBytes} bytes` };
      }
      chunks.push(part.value);
    }
    return { ok: true, body: Buffer.concat(chunks), type: response.headers.get("content-type") ?? "" };
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return { ok: false, error: timedOut ? `${parsed.hostname} did not answer in time` : `${parsed.hostname} could not be reached` };
  }
}

/** The image type of `body` from its first bytes (the Content-Type header is only a claim). */
export function sniffImage(body: Uint8Array): string | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((b, i) => body[offset + i] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** Commons metadata fields are HTML; the page only ever gets plain text. */
export function plainText(html: unknown): string {
  if (typeof html !== "string") return "";
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return named[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function photonUrl(name: string, near: { lat: number; lng: number } | null): string {
  const params = new URLSearchParams({ q: name, limit: "1" });
  if (near) {
    params.set("lat", near.lat.toFixed(2));
    params.set("lon", near.lng.toFixed(2));
    // A light nudge toward the other places: it breaks ties between same-named towns, no more.
    params.set("location_bias_scale", "0.2");
  }
  return `https://photon.komoot.io/api/?${params}`;
}

/** The first feature's position in a Photon GeoJSON answer, or null. */
export function readPhoton(json: unknown): { lat: number; lng: number } | null {
  const coordinates = (json as { features?: { geometry?: { coordinates?: unknown } }[] } | null)?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates;
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const IMAGE_INFO = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1024", format: "json", formatversion: "2" };

export function commonsSearchUrl(query: string): string {
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8", ...IMAGE_INFO });
  return `${COMMONS_API}?${params}`;
}

export function commonsFileUrl(file: string): string {
  return `${COMMONS_API}?${new URLSearchParams({ action: "query", titles: `File:${file}`, ...IMAGE_INFO })}`;
}

export function leadImageUrl(title: string): string {
  const params = new URLSearchParams({ action: "query", titles: title, redirects: "1", prop: "pageimages", piprop: "name", format: "json", formatversion: "2" });
  return `https://en.wikipedia.org/w/api.php?${params}`;
}

/** The lead image file name of a Wikipedia answer, or null. */
export function readLeadImage(json: unknown): string | null {
  const name = (json as { query?: { pages?: { pageimage?: unknown }[] } } | null)?.query?.pages?.[0]?.pageimage;
  return typeof name === "string" && name !== "" ? name : null;
}

type Candidate = Omit<WebPhoto, "src"> & { thumb: string };
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The first freely licensed photo of a Commons imageinfo answer, in search
 * order, with what its credit line needs; null when none can be credited.
 */
export function pickCommonsPhoto(json: unknown): Candidate | null {
  type Meta = Record<string, { value?: unknown } | undefined>;
  type Page = { index?: number; title?: string; imageinfo?: { thumburl?: string; thumbwidth?: number; thumbheight?: number; mime?: string; descriptionurl?: string; extmetadata?: Meta }[] };
  const pages = (json as { query?: { pages?: Page[] } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return null;
  for (const page of [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const licence = plainText(meta.LicenseShortName?.value);
    if (!info?.thumburl || !info.descriptionurl || !PHOTO_TYPES.has(info.mime ?? "") || licence === "") continue;
    if (meta.NonFree?.value !== undefined && String(meta.NonFree.value) !== "false") continue;
    const licenceUrl = typeof meta.LicenseUrl?.value === "string" && meta.LicenseUrl.value.startsWith("https://") ? meta.LicenseUrl.value : null;
    return {
      thumb: info.thumburl,
      width: info.thumbwidth ?? 0,
      height: info.thumbheight ?? 0,
      title: plainText(meta.ObjectName?.value) || (page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
      artist: plainText(meta.Artist?.value) || plainText(meta.Credit?.value) || "Unknown author",
      licence,
      licenceUrl,
      pageUrl: info.descriptionurl,
    };
  }
  return null;
}

/** A time-limited in-memory cache with a total size cap; the oldest entries go first. */
export class MemoryCache<T> {
  private entries = new Map<string, { value: T; size: number; expires: number }>();
  private total = 0;
  constructor(private readonly maxBytes: number, private readonly now: () => number = Date.now) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) {
      this.total -= entry.size;
      return undefined;
    }
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, size: number, ttlMs: number): void {
    const old = this.entries.get(key);
    if (old) {
      this.total -= old.size;
      this.entries.delete(key);
    }
    if (size > this.maxBytes) return;
    this.entries.set(key, { value, size, expires: this.now() + ttlMs });
    this.total += size;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.total -= entry.size;
    }
  }
}

/** Runs at most `max` tasks at once; the rest wait their turn. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const OFF: WebFailure = { ok: false, off: true, error: "Web lookups are off in the OpenUI plugin settings" };
const normal = (text: string) => text.trim().replace(/\s+/g, " ");
const dataUrl = (type: string, body: Buffer) => `data:${type};base64,${body.toString("base64")}`;
const json = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
};

type Out<K extends keyof typeof webMethods> = z.infer<(typeof webMethods)[K]["output"]>;

/** The lookups behind the web_* RPC methods. The setting is read on every call, so a change applies at once. */
export function createWeb(settings: { get(): Promise<{ webLookups: boolean }> }, fetcher: Fetcher = fetch) {
  const isOn = async () => (await settings.get()).webLookups;
  // 96 MB of tiles and photos as base64 strings, plus small JSON answers.
  const cache = new MemoryCache<unknown>(96 * 1024 * 1024);
  const inFlight = new Map<string, Promise<unknown>>();
  const tiles = limiter(2); // OSM tile policy: few parallel requests
  const api = limiter(2);
  let nextPhotonAt = 0;

  /** Cached, de-duplicated, behind the setting. */
  async function lookup<T extends { ok: boolean }>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T | WebFailure> {
    if (!(await isOn())) return OFF;
    const hit = cache.get(key) as T | undefined;
    if (hit) return hit;
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const started = run()
      .then((result) => {
        const size = JSON.stringify(result).length;
        // Failures (a miss, a timeout, a busy service) are kept only a minute, so they are retried soon.
        cache.set(key, result, size, result.ok ? ttlMs : 60_000);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  }

  const jsonGet = (url: string) => api(() => get(url, { accept: "application/json", maxBytes: 2 * 1024 * 1024, timeoutMs: 12_000 }, fetcher));

  async function photoFrom(candidate: Candidate | null, missing: string): Promise<Out<"web_image_search">> {
    if (!candidate) return { ok: false, error: missing };
    const image = await api(() => get(candidate.thumb, { accept: "image/jpeg,image/png,image/webp", maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 }, fetcher));
    if (!image.ok) return image;
    const type = sniffImage(image.body);
    if (!type) return { ok: false, error: "Commons sent something that is not a photo" };
    const { thumb: _, ...rest } = candidate;
    return { ok: true, photo: { ...rest, src: dataUrl(type, image.body) } };
  }

  return {
    geocode({ name, nearLat, nearLng }: z.infer<(typeof webMethods)["web_geocode"]["input"]>) {
      const near = nearLat !== undefined && nearLng !== undefined ? { lat: nearLat, lng: nearLng } : null;
      const wanted = normal(name);
      return lookup(`geo:${wanted.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ""}`, 30 * DAY, async (): Promise<Out<"web_geocode">> => {
        // Photon asks for fair use: one request a second at most.
        const now = Date.now();
        const slot = Math.max(now, nextPhotonAt);
        nextPhotonAt = slot + PHOTON_SPACING_MS;
        if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
        const got = await get(photonUrl(wanted, near), { accept: "application/json", maxBytes: 512 * 1024, timeoutMs: 12_000 }, fetcher);
        if (!got.ok) return got;
        const found = readPhoton(json(got.body));
        return found ? { ok: true, ...found } : { ok: false, error: `“${wanted}” was not found on the map` };
      });
    },
    tile({ z: zoom, x, y }: z.infer<(typeof webMethods)["web_tile"]["input"]>) {
      if (x >= 2 ** zoom || y >= 2 ** zoom) return Promise.resolve<WebFailure>({ ok: false, error: "no such tile" });
      // OSM keeps tiles cacheable for 7 days.
      return lookup(`tile:${zoom}/${x}/${y}`, 7 * DAY, async (): Promise<Out<"web_tile">> => {
        const got = await tiles(() => get(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, { accept: "image/png", maxBytes: 1024 * 1024, timeoutMs: 15_000 }, fetcher));
        if (!got.ok) return got;
        return sniffImage(got.body) === "image/png" ? { ok: true, dataUrl: dataUrl("image/png", got.body) } : { ok: false, error: "the tile server sent something other than a tile" };
      });
    },
    imageSearch({ query }: z.infer<(typeof webMethods)["web_image_search"]["input"]>) {
      const wanted = normal(query);
      return lookup(`search:${wanted.toLowerCase()}`, 30 * DAY, async () => {
        const got = await jsonGet(commonsSearchUrl(wanted));
        if (!got.ok) return got;
        return photoFrom(pickCommonsPhoto(json(got.body)), `No freely licensed photo was found for “${wanted}”`);
      });
    },
    wikiPhoto({ title }: z.infer<(typeof webMethods)["web_wiki_photo"]["input"]>) {
      const wanted = normal(title);
      return lookup(`wiki:${wanted}`, 30 * DAY, async (): Promise<Out<"web_wiki_photo">> => {
        const page = await jsonGet(leadImageUrl(wanted));
        if (!page.ok) return page;
        const file = readLeadImage(json(page.body));
        const missing = `The Wikipedia article “${wanted}” has no photo that can be credited`;
        if (!file) return { ok: false, error: missing };
        // A lead image that is not on Commons is a local, usually non-free file: no photo.
        const info = await jsonGet(commonsFileUrl(file));
        if (!info.ok) return info;
        return photoFrom(pickCommonsPhoto(json(info.body)), missing);
      });
    },
  };
}
