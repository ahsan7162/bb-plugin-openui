// Maps, media and sandbox: Map (OpenStreetMap tiles, numbered pins, a list),
// ImageSearch (a credited Wikimedia Commons photo), App (an agent-written
// HTML page in a sandboxed frame with no network) and Shader (a Shadertoy-
// style GLSL fragment shader on WebGL 2). Map and ImageSearch fetch through
// the server (server/web.ts), behind the webLookups setting; nothing here
// contacts another host. Pure helpers are exported for web.test.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { defineComponent } from "@openuidev/react-lang";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { z } from "zod/v4";
import type { rpcContract } from "../../server";
import { Button, EmptyState, ErrorState, Skeleton, cx, useAsk, useStreaming } from "./kit";
import type { ExtraGroup } from "./types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Photo = { src: string; width: number; height: number; title: string; artist: string; licence: string; licenceUrl: string | null; pageUrl: string };
const OFF_HINT = "Web lookups are off in the OpenUI plugin settings. Turn them on to load it.";

/** An external link. Not the SDK's UrlLink: that one needs a slot environment check-group's server render lacks. */
function UrlLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/* ---------------------------------------------------------------- Map */

const TILE = 256;
/** The map's logical viewport; the frame keeps this aspect and scales, so tiles and pins are placed in %. */
export const VIEW = { w: 640, h: 360 };
const MAX_ZOOM = 16;

/** Web Mercator world pixels at `zoom`. */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

/** The highest zoom (capped, so one place is not a street close-up) at which every point fits inside the padded view, and its centre. */
export function fitView(points: { lat: number; lng: number }[], pad = 40, maxZoom = MAX_ZOOM): { zoom: number; cx: number; cy: number } {
  // shortcut: no antimeridian handling, so a route across the Pacific zooms out to the whole world.
  for (let zoom = maxZoom; zoom >= 0; zoom--) {
    const xy = points.map((p) => project(p.lat, p.lng, zoom));
    const xs = xy.map((p) => p.x);
    const ys = xy.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (zoom === 0 || (x1 - x0 <= VIEW.w - 2 * pad && y1 - y0 <= VIEW.h - 2 * pad)) return { zoom, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  return { zoom: 0, cx: TILE / 2, cy: TILE / 2 };
}

/** The tiles that cover the view, with their position in view pixels; x wraps round the world, y stops at the poles. */
export function tilesFor({ zoom, cx, cy }: { zoom: number; cx: number; cy: number }) {
  const n = 2 ** zoom;
  const left = cx - VIEW.w / 2;
  const top = cy - VIEW.h / 2;
  const tiles: { key: string; x: number; y: number; left: number; top: number }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + VIEW.w - 1) / TILE); tx++) {
    for (let ty = Math.max(0, Math.floor(top / TILE)); ty <= Math.min(n - 1, Math.floor((top + VIEW.h - 1) / TILE)); ty++) {
      const x = ((tx % n) + n) % n;
      tiles.push({ key: `${zoom}/${x}/${ty}@${tx}`, x, y: ty, left: tx * TILE - left, top: ty * TILE - top });
    }
  }
  return tiles;
}

type PlaceIn = { name?: string; lat?: number | null; lng?: number | null; note?: string | null; day?: number | string | null; wiki?: string | null };
export type Place = { name: string; note: string; day: string | null; wiki: string; given: { lat: number; lng: number } | null };

/** Places as written, from MapPlace nodes (possibly partial while streaming). A place without `day` keeps the day of the one before. */
export function readPlaces(items: unknown): Place[] {
  if (!Array.isArray(items)) return [];
  let day: string | null = null;
  const places: Place[] = [];
  for (const item of items) {
    const p = ((item as { props?: PlaceIn } | null)?.props ?? {}) as PlaceIn;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (name === "") continue;
    if (typeof p.day === "number" && Number.isFinite(p.day)) day = `Day ${p.day}`;
    else if (typeof p.day === "string" && p.day.trim() !== "") day = p.day.trim().slice(0, 40);
    const { lat, lng } = p;
    const valid = typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    places.push({ name, note: typeof p.note === "string" ? p.note : "", day, wiki: typeof p.wiki === "string" ? p.wiki.trim() : "", given: valid ? { lat, lng } : null });
  }
  return places;
}

/** Place indexes by day, days in the order they first appear: one route line per day. */
export function routeGroups(places: Place[]): { day: string | null; indexes: number[] }[] {
  const groups = new Map<string | null, number[]>();
  places.forEach((place, i) => groups.set(place.day, [...(groups.get(place.day) ?? []), i]));
  return [...groups].map(([day, indexes]) => ({ day, indexes }));
}

type Located = { lat: number; lng: number } | { error: string };

/** Coordinates for places given by name only, looked up once the block is complete. */
function useGeocoded(places: Place[], active: boolean, rpc: Rpc, onOff: () => void): Record<string, Located> {
  const [found, setFound] = useState<Record<string, Located>>({});
  const wanted = places.filter((p) => p.given === null).map((p) => p.name);
  const key = wanted.join("\n");
  useEffect(() => {
    if (!active || wanted.length === 0) return;
    let live = true;
    const given = places.flatMap((p) => (p.given ? [p.given] : []));
    // Nudge the lookups toward the places that came with coordinates.
    const near = given.length > 0 ? { nearLat: given.reduce((s, p) => s + p.lat, 0) / given.length, nearLng: given.reduce((s, p) => s + p.lng, 0) / given.length } : {};
    for (const name of new Set(wanted)) {
      rpc
        .call("web_geocode", { name: name.slice(0, 200), ...near })
        .then((r) => {
          if (r.ok === false && r.off) onOff();
          if (live) setFound((all) => ({ ...all, [name]: r.ok ? { lat: r.lat, lng: r.lng } : { error: r.error } }));
        })
        .catch((cause: unknown) => live && setFound((all) => ({ ...all, [name]: { error: errorText(cause) } })));
    }
    return () => {
      live = false;
    };
    // `key` stands for `wanted`; places only matter through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, rpc]);
  return found;
}

/** Tile images as data URLs, by tile key; "error" for one that failed. */
function useTiles(tiles: { key: string; x: number; y: number }[], zoom: number, active: boolean, rpc: Rpc, onOff: () => void) {
  const [images, setImages] = useState<Record<string, string>>({});
  const key = tiles.map((t) => t.key).join(",");
  useEffect(() => {
    if (!active) return;
    let live = true;
    for (const tile of tiles) {
      rpc
        .call("web_tile", { z: zoom, x: tile.x, y: tile.y })
        .then((r) => {
          if (r.ok === false && r.off) onOff();
          if (live) setImages((all) => ({ ...all, [tile.key]: r.ok ? r.dataUrl : "error" }));
        })
        .catch(() => live && setImages((all) => ({ ...all, [tile.key]: "error" })));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, rpc]);
  return images;
}

const percent = (value: number, of: number) => `${(value / of) * 100}%`;

const MapPlaceDef = defineComponent({
  name: "MapPlace",
  description: "One stop on a Map. lat and lng are optional (the name is looked up); day groups stops for the route; wiki is an English Wikipedia title whose photo shows when picked.",
  props: z.object({
    name: z.string(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    note: z.string().nullish(),
    day: z.union([z.number(), z.string()]).nullish(),
    wiki: z.string().nullish(),
  }),
  component: () => null,
});

const MapDef = defineComponent({
  name: "Map",
  description: "OpenStreetMap map with numbered pins and a list of the places. route draws a line through them in order, one per day; tour adds previous and next buttons to step through the stops.",
  props: z.object({
    places: z.array(MapPlaceDef.ref),
    route: z.boolean().nullish(),
    tour: z.boolean().nullish(),
  }),
  component: ({ props }) => <MapView places={props.places} route={props.route === true} tour={props.tour === true} />,
});

function MapView({ places: items, route, tour }: { places: unknown; route: boolean; tour: boolean }) {
  const streaming = useStreaming();
  const rpc = useRpc<typeof rpcContract>();
  // The server is the switch: it answers `off` while web lookups are off.
  const [off, setOff] = useState(false);
  const markOff = () => setOff(true);
  const places = useMemo(() => readPlaces(items), [items]);
  const active = !streaming && !off && places.length > 0;
  const geocoded = useGeocoded(places, active, rpc, markOff);
  const located = places.map((p) => p.given ?? geocoded[p.name] ?? null);
  const points = located.map((l) => (l !== null && "lat" in l ? l : null));
  const known = points.filter((p): p is { lat: number; lng: number } => p !== null);
  const pending = located.some((l) => l === null);
  const view = useMemo(() => (known.length > 0 ? fitView(known) : null), [JSON.stringify(known)]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = useMemo(() => (view ? tilesFor(view) : []), [view]);
  const images = useTiles(tiles, view?.zoom ?? 0, active && view !== null && !pending, rpc, markOff);
  const [selected, setSelected] = useState<number | null>(null);
  const pick = selected !== null && selected < places.length ? selected : null;
  const groups = routeGroups(places);
  const dayIndex = new Map(groups.map((g, i) => [g.day, i]));
  const missing = places.filter((_, i) => located[i] !== null && !("lat" in located[i]!));

  const at = (p: { lat: number; lng: number }) => {
    const xy = project(p.lat, p.lng, view!.zoom);
    return { x: xy.x - view!.cx + VIEW.w / 2, y: xy.y - view!.cy + VIEW.h / 2 };
  };

  let frame;
  if (places.length === 0) {
    frame = streaming ? <Skeleton height={200} /> : <EmptyState title="No places to map" hint="Give Map a list of MapPlace items, each with a name." />;
  } else if (off) {
    frame = <EmptyState title="The map is not shown" hint={`Maps need web lookups to load tiles and find places. ${OFF_HINT}`} />;
  } else if (streaming || view === null || pending) {
    frame = known.length === 0 && !pending && !streaming ? (
      <ErrorState title="None of these places were found" detail="Give each MapPlace its lat and lng, or a fuller name such as the city and country." />
    ) : (
      <div className="bbui-web-frame">
        <Skeleton height={VIEW.h} />
      </div>
    );
  } else {
    frame = (
      <div className="bbui-web-frame">
        {tiles.map((t) =>
          images[t.key] && images[t.key] !== "error" ? (
            <img
              key={t.key}
              className="bbui-web-tile"
              src={images[t.key]}
              alt=""
              draggable={false}
              style={{ left: percent(t.left, VIEW.w), top: percent(t.top, VIEW.h), width: percent(TILE, VIEW.w), height: percent(TILE, VIEW.h) }}
            />
          ) : null,
        )}
        {route ? (
          <svg className="bbui-web-route" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="none" aria-hidden="true">
            {groups.map((g, gi) => {
              const line = g.indexes.flatMap((i) => (points[i] ? [at(points[i]!)] : []));
              return line.length > 1 ? <polyline key={gi} className={`bbui-web-line bbui-web-series-${gi % 4}`} points={line.map((p) => `${p.x},${p.y}`).join(" ")} /> : null;
            })}
          </svg>
        ) : null}
        {places.map((place, i) => {
          if (!points[i]) return null;
          const p = at(points[i]!);
          return (
            <button
              key={i}
              type="button"
              className="bbui-web-pin"
              aria-pressed={pick === i}
              aria-label={`${i + 1}. ${place.name}`}
              style={{ left: percent(p.x, VIEW.w), top: percent(p.y, VIEW.h) }}
              onClick={() => setSelected(pick === i ? null : i)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    );
  }

  const chosen = pick !== null ? places[pick] : null;
  return (
    <figure className="bbui bbui-web-map">
      <div className="bbui-web-map-body">
        {frame}
        <ol className="bbui-web-list" aria-label="Places">
          {places.map((place, i) => {
            const header = route && place.day !== null && (i === 0 || places[i - 1]!.day !== place.day) ? place.day : null;
            const failed = located[i] !== null && !("lat" in located[i]!);
            return (
              <li key={i}>
                {header ? (
                  <span className="bbui-web-day">
                    <span className={`bbui-web-swatch bbui-web-series-${(dayIndex.get(place.day) ?? 0) % 4}`} aria-hidden="true" />
                    {header}
                  </span>
                ) : null}
                <button type="button" className="bbui-web-place" aria-pressed={pick === i} disabled={streaming} onClick={() => setSelected(pick === i ? null : i)}>
                  <span className="bbui-web-num">{i + 1}</span>
                  <span className="bbui-web-place-text">
                    <span className="bbui-head">{place.name}</span>
                    {place.note ? <span className="bbui-label">{place.note}</span> : null}
                    {failed && !off ? <span className="bbui-label">Not found on the map</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {tour && places.length > 1 && !off ? (
        <div className="bbui-web-tour">
          <Button disabled={streaming || pick === 0} aria-label="Previous stop" onClick={() => setSelected(pick === null ? 0 : pick - 1)}>
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            Previous
          </Button>
          <span className="bbui-label" aria-live="polite">
            {pick === null ? `${places.length} stops` : `Stop ${pick + 1} of ${places.length}`}
          </span>
          <Button disabled={streaming || pick === places.length - 1} aria-label="Next stop" onClick={() => setSelected(pick === null ? 0 : pick + 1)}>
            Next
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {chosen?.wiki && !off ? <WikiPhoto key={chosen.wiki} title={chosen.wiki} name={chosen.name} rpc={rpc} /> : null}
      {!off && places.length > 0 ? (
        <figcaption className="bbui-web-credit">
          Map data ©{" "}
          <UrlLink href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</UrlLink>
          {missing.length > 0 ? `. Not found: ${missing.map((p) => p.name).join(", ")}.` : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function WikiPhoto({ title, name, rpc }: { title: string; name: string; rpc: Rpc }) {
  const [state, setState] = useState<{ photo: Photo } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    rpc
      .call("web_wiki_photo", { title: title.slice(0, 300) })
      .then((r) => live && setState(r.ok ? { photo: r.photo } : { error: r.error }))
      .catch((cause: unknown) => live && setState({ error: errorText(cause) }));
    return () => {
      live = false;
    };
  }, [title, rpc]);
  if (state === null) return <Skeleton height={160} />;
  if ("error" in state) return <p className="bbui-label">{state.error}</p>;
  return <PhotoFigure photo={state.photo} alt={name} aspect="wide" />;
}

/* ---------------------------------------------------------------- ImageSearch */

type Aspect = "wide" | "square" | "tall";

function PhotoFigure({ photo, alt, aspect }: { photo: Photo; alt: string; aspect: Aspect }) {
  return (
    <figure className="bbui bbui-web-photo" data-aspect={aspect}>
      <div className="bbui-web-photo-frame">
        <img src={photo.src} alt={alt} width={photo.width || undefined} height={photo.height || undefined} />
      </div>
      <figcaption className="bbui-web-credit">
        {photo.title}. Photo: {photo.artist},{" "}
        {photo.licenceUrl ? <UrlLink href={photo.licenceUrl}>{photo.licence}</UrlLink> : photo.licence}, via{" "}
        <UrlLink href={photo.pageUrl}>Wikimedia Commons</UrlLink>
      </figcaption>
    </figure>
  );
}

const ImageSearchDef = defineComponent({
  name: "ImageSearch",
  description: "A freely licensed, credited photo from Wikimedia Commons for query (a short literal description, e.g. \"red fox in snow\"). aspect: wide (default), square or tall.",
  props: z.object({
    query: z.string(),
    alt: z.string().nullish(),
    aspect: z.enum(["wide", "square", "tall"]).nullish(),
  }),
  component: ({ props }) => <ImageSearchView query={props.query ?? ""} alt={props.alt ?? ""} aspect={props.aspect ?? "wide"} />,
});

function ImageSearchView({ query, alt, aspect }: { query: string; alt: string; aspect: Aspect }) {
  const streaming = useStreaming();
  const rpc = useRpc<typeof rpcContract>();
  const wanted = query.trim().slice(0, 200);
  const [state, setState] = useState<{ photo: Photo } | { error: string; off?: boolean } | null>(null);
  useEffect(() => {
    if (streaming || wanted === "") return;
    let live = true;
    setState(null);
    rpc
      .call("web_image_search", { query: wanted })
      .then((r) => live && setState(r.ok ? { photo: r.photo } : { error: r.error, off: r.off }))
      .catch((cause: unknown) => live && setState({ error: errorText(cause) }));
    return () => {
      live = false;
    };
  }, [streaming, wanted, rpc]);

  let body;
  if (wanted === "" && !streaming) body = <EmptyState title="No photo to search for" hint="Give ImageSearch a short description of the photo." />;
  else if (state && "off" in state && state.off) body = <EmptyState title="The photo is not shown" hint={`ImageSearch needs web lookups to find "${wanted}". ${OFF_HINT}`} />;
  else if (state === null)
    body = (
      <div className="bbui-web-photo-frame" data-aspect={aspect} role="status" aria-label={`Finding a photo of ${wanted}`}>
        <Skeleton height={120} />
      </div>
    );
  else if ("error" in state) body = <ErrorState title="No photo could be shown" detail={`${state.error}. Try a shorter, more literal description.`} />;
  else return <PhotoFigure photo={state.photo} alt={alt || wanted} aspect={aspect} />;
  return (
    <div className="bbui bbui-web-photo" data-aspect={aspect}>
      {body}
    </div>
  );
}

/* ---------------------------------------------------------------- App */

/** No network at all: inline script and style only; images, fonts and media from data: or blob: URLs. */
export const APP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

// Each rule: what in the source reaches the network, and how to say so.
// shortcut: a regex scan, so a JS comment that mentions fetch() is refused too; a real parser if that bites.
const NETWORK_RULES: [RegExp, string][] = [
  [/<script\b[^>]*\ssrc\s*=/gi, "<script src> loads a file"],
  [/<link\b[^>]*\shref\s*=\s*(?!["']?(?:data:|#))/gi, "<link href> loads a file"],
  [/<(?:img|video|audio|source|track|iframe|embed|object|input)\b[^>]*\s(?:src|srcset|poster|data)\s*=\s*(?!["']?(?:data:|blob:|#)|""|''|[\s>])/gi, "an element loads a file from a URL"],
  [/<(?:image|use|feImage)\b[^>]*\s(?:xlink:)?href\s*=\s*(?!["']?(?:data:|#))/gi, "an SVG element loads a file"],
  [/<a\b[^>]*\shref\s*=\s*["']?(?:https?:)?\/\//gi, "a link leaves the page"],
  [/<base\b/gi, "<base> points the page at a server"],
  [/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/gi, "a meta refresh loads another page"],
  [/url\(\s*(?!["']?(?:data:|blob:|#|["']?\s*\)))/gi, "CSS url() loads a file"],
  [/@import\b/gi, "CSS @import loads a file"],
  [/\bfetch\s*\(/g, "fetch() reaches the network"],
  [/\bXMLHttpRequest\b/g, "XMLHttpRequest reaches the network"],
  [/\b(?:WebSocket|EventSource|RTCPeerConnection)\b/g, "a socket reaches the network"],
  [/\bsendBeacon\b/g, "sendBeacon reaches the network"],
  [/\bimport\s*\(|\bimport\b[^;\n]*\bfrom\s*["']/g, "import loads a module"],
  [/\blocation(?:\.href)?\s*=(?!=)|\blocation\.(?:assign|replace)\s*\(/g, "changing location loads another page"],
];

/** Where the page would use the network, in source order with 1-based lines; empty when it runs offline. */
export function findNetworkUse(html: string): { line: number; what: string }[] {
  const page = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, " "));
  const found: { line: number; what: string; at: number }[] = [];
  for (const [rule, what] of NETWORK_RULES) {
    for (const match of page.matchAll(rule)) {
      found.push({ at: match.index, what, line: page.slice(0, match.index).split("\n").length });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ line, what }) => ({ line, what }));
}

/** The page's height to the host, uncaught errors, CSP blocks and bbui.send(text). */
const BRIDGE = `(function(){
var post=function(m){m.bbui=1;parent.postMessage(m,"*");};
var last=-1;
function size(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;post({type:"height",height:h});}}
new ResizeObserver(size).observe(document.documentElement);
addEventListener("load",size);
addEventListener("error",function(e){post({type:"error",message:String(e.message||"a script failed")});});
addEventListener("securitypolicyviolation",function(e){post({type:"error",message:"blocked "+(e.blockedURI||e.effectiveDirective)+": the page has no network"});});
window.bbui={send:function(text){post({type:"send",text:String(text)});}};
})();`;

const THEME_VARS = ["--foreground", "--muted-foreground", "--border", "--primary", "--primary-foreground", "--card", "--muted", "--font-sans", "--font-mono"];

/** The frame's document: our CSP, BB's theme variables and the bridge first, then the page as written (its doctype dropped so ours keeps standards mode). */
export function appDocument(html: string, theme: Record<string, string>, colorScheme = "light dark"): string {
  const clean = (value: string) => value.replace(/[<>;{}]/g, "");
  const vars = Object.entries(theme)
    .filter(([name, value]) => /^--[a-z-]+$/.test(name) && value.trim() !== "")
    .map(([name, value]) => `${name}:${clean(value)};`)
    .join("");
  const base = `:root{${vars}color-scheme:${clean(colorScheme)}}html,body{margin:0;background:transparent;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:13px;line-height:1.55}`;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${APP_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}</style><script>${BRIDGE}</script>\n${html.replace(/^\s*<!doctype[^>]*>/i, "")}`;
}

const MAX_APP_HEIGHT = 1200; // a 100vh layout would otherwise grow the frame without end
const MAX_SEND_CHARS = 2000;

const AppDef = defineComponent({
  name: "App",
  description: "A small self-contained HTML, CSS and JS page run in a sandboxed frame with no network. Inline everything; see the notes for theme variables and bbui.send(text).",
  props: z.object({
    html: z.string(),
    title: z.string().nullish(),
  }),
  component: ({ props }) => <AppView html={props.html ?? ""} title={props.title ?? ""} />,
});

function AppView({ html, title }: { html: string; title: string }) {
  const streaming = useStreaming();
  const problems = useMemo(() => (streaming ? [] : findNetworkUse(html)), [html, streaming]);
  const caption = title ? <figcaption className="bbui-head">{title}</figcaption> : null;
  if (streaming || html.trim() === "") {
    return (
      <figure className="bbui bbui-web-app">
        {caption}
        {html.trim() === "" && !streaming ? (
          <EmptyState title="No page to run" hint="Give App the page's HTML, with its CSS and JS inline." />
        ) : (
          <>
            <span className="bbui-label">The page runs when the reply finishes.</span>
            <pre className="bbui-well bbui-mono bbui-web-source">{html}</pre>
          </>
        )}
      </figure>
    );
  }
  if (problems.length > 0) {
    return (
      <figure className="bbui bbui-web-app">
        {caption}
        <ErrorState
          title="This page was not run: it uses the network"
          detail={`Pages run offline. ${problems.slice(0, 6).map((p) => `Line ${p.line}: ${p.what}.`).join(" ")} Inline the code, styles and images (data: URLs) instead.`}
        />
        <details className="bbui-web-details">
          <summary className="bbui-label">Page source</summary>
          <pre className="bbui-well bbui-mono bbui-web-source">{html}</pre>
        </details>
      </figure>
    );
  }
  return <AppFrame html={html} title={title} caption={caption} />;
}

function AppFrame({ html, title, caption }: { html: string; title: string; caption: ReactNode }) {
  const ask = useAsk();
  const holder = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState<{ vars: Record<string, string>; scheme: string } | null>(null);
  const [height, setHeight] = useState(160);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const lastSend = useRef(0);

  // Read BB's theme where the block sits, before the frame exists.
  useLayoutEffect(() => {
    const style = getComputedStyle(holder.current ?? document.documentElement);
    setTheme({ vars: Object.fromEntries(THEME_VARS.map((name) => [name, style.getPropertyValue(name).trim()])), scheme: style.colorScheme || "light dark" });
  }, []);
  const srcDoc = useMemo(() => (theme ? appDocument(html, theme.vars, theme.scheme) : null), [html, theme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // The frame's origin is opaque ("null"), so the sender is checked by window, not origin.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { bbui?: number; type?: string; height?: unknown; message?: unknown; text?: unknown } | null;
      if (data?.bbui !== 1) return;
      if (data.type === "height" && typeof data.height === "number" && Number.isFinite(data.height)) {
        setHeight(Math.min(MAX_APP_HEIGHT, Math.max(24, Math.ceil(data.height))));
      } else if (data.type === "error" && typeof data.message === "string") {
        setNote(`The page reported: ${data.message.slice(0, 300)}`);
      } else if (data.type === "send" && typeof data.text === "string" && data.text.trim() !== "") {
        const text = data.text.trim().slice(0, MAX_SEND_CHARS);
        const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
        // A click inside the frame activates this window and focuses the frame; without both, the page may not speak for the user.
        if (activation === undefined) setConfirm(text);
        else if (!activation.isActive || document.activeElement !== frame.current) setNote("The page tried to send a message without a click, so it was not sent.");
        else if (Date.now() - lastSend.current > 1000) {
          lastSend.current = Date.now();
          ask(text);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ask]);

  return (
    <figure className="bbui bbui-web-app" ref={holder}>
      {caption}
      {srcDoc === null ? (
        <Skeleton height={120} />
      ) : (
        <iframe ref={frame} className="bbui-web-frame-app" title={title || "Page"} sandbox="allow-scripts" srcDoc={srcDoc} style={{ height }} />
      )}
      {confirm !== null ? (
        <div className="bbui-web-confirm">
          <span className="bbui-label">The page wants to send: {confirm}</span>
          <Button
            variant="primary"
            onClick={() => {
              ask(confirm);
              setConfirm(null);
            }}
          >
            Send
          </Button>
          <Button onClick={() => setConfirm(null)}>Dismiss</Button>
        </div>
      ) : null}
      {note ? (
        <p className="bbui-label bbui-web-note" role="status">
          {note}
        </p>
      ) : null}
    </figure>
  );
}

/* ---------------------------------------------------------------- Shader */

/** Declares Shadertoy's inputs before the agent's code; a main() after it calls mainImage. */
export const SHADER_HEAD = [
  "#version 300 es",
  "precision highp float;",
  "uniform vec3 iResolution;",
  "uniform float iTime;",
  "uniform float iTimeDelta;",
  "uniform int iFrame;",
  "uniform vec4 iMouse;",
  "out vec4 bbuiColor;",
  "",
].join("\n");
const HEAD_LINES = SHADER_HEAD.split("\n").length - 1;

/** The complete fragment program; a #version the agent wrote is blanked so line numbers stay put. */
export function shaderSource(code: string): string {
  const body = code.replace(/^[ \t]*#version[^\n]*/gm, "");
  return `${SHADER_HEAD}${body}\nvoid main() {\n  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);\n  mainImage(color, gl_FragCoord.xy);\n  bbuiColor = color;\n}\n`;
}

/** The compile log as messages on the agent's own lines (null when a message is about the added code). */
export function compileErrors(log: string, codeLines: number): { line: number | null; message: string }[] {
  return log
    .split("\n")
    .map((raw) => raw.trim())
    .filter((raw) => raw !== "" && raw !== "\0")
    .map((raw) => {
      const match = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw);
      if (!match) return { line: null, message: raw };
      const line = Number(match[1]) - HEAD_LINES;
      return { line: line >= 1 && line <= codeLines ? line : null, message: match[2]! };
    });
}

const VERTEX = "#version 300 es\nin vec2 corner;\nvoid main() { gl_Position = vec4(corner, 0.0, 1.0); }\n";

const ShaderDef = defineComponent({
  name: "Shader",
  description: "A Shadertoy-style GLSL fragment shader: define void mainImage(out vec4 fragColor, in vec2 fragCoord); iTime, iResolution and iMouse are provided. Write line breaks as \\n.",
  props: z.object({
    code: z.string(),
    title: z.string().nullish(),
  }),
  component: ({ props }) => <ShaderView code={props.code ?? ""} title={props.title ?? ""} />,
});

type ShaderState = { kind: "idle" } | { kind: "running" } | { kind: "failed"; title: string; errors: { line: number | null; message: string }[] };

function ShaderView({ code, title }: { code: string; title: string }) {
  const streaming = useStreaming();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ShaderState>({ kind: "idle" });
  const [playing, setPlaying] = useState(true);
  const control = useRef<{ setPlaying(on: boolean): void } | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (streaming || !element || code.trim() === "") return;
    if (!/\bmainImage\s*\(/.test(code)) {
      setState({ kind: "failed", title: "The shader has no mainImage", errors: [{ line: null, message: "Define void mainImage(out vec4 fragColor, in vec2 fragCoord)." }] });
      return;
    }
    const gl = element.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
      setState({ kind: "failed", title: "The shader could not run", errors: [{ line: null, message: "WebGL 2 is not available in this browser." }] });
      return;
    }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, shaderSource(code));
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
      setState({ kind: "failed", title: "The shader did not compile", errors: compileErrors(gl.getShaderInfoLog(fragment) ?? "", code.split("\n").length) });
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setState({ kind: "failed", title: "The shader did not link", errors: compileErrors(gl.getProgramInfoLog(program) ?? "", 0) });
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const [uResolution, uTime, uDelta, uFrame, uMouse] = ["iResolution", "iTime", "iTimeDelta", "iFrame", "iMouse"].map(u);
    const mouse = [0, 0, 0, 0];
    let time = 0;
    let delta = 0;
    let frames = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let on = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlaying(on);

    const draw = () => {
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform3f(uResolution, element.width, element.height, 1);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uDelta, delta);
      gl.uniform1i(uFrame, frames);
      gl.uniform4f(uMouse, mouse[0]!, mouse[1]!, mouse[2]!, mouse[3]!);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tick = (now: number) => {
      delta = last === 0 ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      time += delta;
      frames++;
      draw();
      raf = requestAnimationFrame(tick);
    };
    // The loop runs only while playing and on screen.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (on && visible) raf = requestAnimationFrame(tick);
    };
    const resize = () => {
      const ratio = Math.min(2, devicePixelRatio || 1);
      element.width = Math.max(1, Math.round(element.clientWidth * ratio));
      element.height = Math.max(1, Math.round(element.clientHeight * ratio));
      if (!on || !visible) draw();
    };
    const sizes = new ResizeObserver(resize);
    sizes.observe(element);
    const sight = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      schedule();
    });
    sight.observe(element);
    // Shadertoy's iMouse: xy while pressed, zw the press point, negated once released; y counts up from the bottom.
    const position = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      return [((event.clientX - box.left) / box.width) * element.width, ((box.bottom - event.clientY) / box.height) * element.height] as const;
    };
    const down = (event: PointerEvent) => {
      const [x, y] = position(event);
      mouse.splice(0, 4, x, y, x, y);
      element.setPointerCapture(event.pointerId);
      if (!on) draw();
    };
    const move = (event: PointerEvent) => {
      if (mouse[2]! <= 0) return;
      const [x, y] = position(event);
      mouse[0] = x;
      mouse[1] = y;
      if (!on) draw();
    };
    const up = () => {
      mouse[2] = -Math.abs(mouse[2]!);
      mouse[3] = -Math.abs(mouse[3]!);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    control.current = {
      setPlaying(next) {
        on = next;
        schedule();
      },
    };
    setState({ kind: "running" });
    resize();
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      sight.disconnect();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      control.current = null;
      // shortcut: browsers cap live WebGL contexts (about 16); releasing on unmount keeps long chats under it.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [code, streaming]);

  const lines = code.split("\n");
  return (
    <figure className="bbui bbui-web-shader">
      {title ? <figcaption className="bbui-head">{title}</figcaption> : null}
      {state.kind === "failed" ? (
        <div className="bbui-error" role="alert">
          <span className="bbui-head">{state.title}</span>
          <ol className="bbui-web-errors">
            {state.errors.slice(0, 8).map((e, i) => (
              <li key={i} className="bbui-label">
                {e.line !== null ? `Line ${e.line}: ` : null}
                {e.message}
                {e.line !== null && lines[e.line - 1]?.trim() ? <code className="bbui-mono bbui-web-code-line">{lines[e.line - 1]!.trim()}</code> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <canvas
            ref={canvas}
            className={cx("bbui-web-canvas", streaming && "bbui-web-canvas-wait")}
            role="img"
            aria-label={title ? `Animated shader: ${title}` : "Animated shader"}
          />
          <div className="bbui-web-shader-bar">
            <Button
              disabled={state.kind !== "running"}
              onClick={() => {
                setPlaying(!playing);
                control.current?.setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
              {playing ? "Pause" : "Play"}
            </Button>
            {streaming ? <span className="bbui-label">The shader runs when the reply finishes.</span> : null}
          </div>
        </>
      )}
    </figure>
  );
}

/* ---------------------------------------------------------------- group */

const MAP_EXAMPLE = String.raw`root = Stack([title, map])
title = TextContent("Sample plan: two days in Lisbon")
map = Map([p1, p2, p3, p4, p5, p6], true, true)
p1 = MapPlace("Belém Tower", 38.6916, -9.2160, "Opens at 10:00; go early.", 1, "Belém Tower")
p2 = MapPlace("Jerónimos Monastery", 38.6979, -9.2068, "Cloister ticket needed.", null, "Jerónimos Monastery")
p3 = MapPlace("LX Factory", 38.7036, -9.1784, "Lunch and bookshops.")
p4 = MapPlace("São Jorge Castle", 38.7139, -9.1335, "Views over the river.", 2, "São Jorge Castle")
p5 = MapPlace("Alfama, Lisbon", null, null, "Walk down through the lanes.")
p6 = MapPlace("Praça do Comércio", 38.7075, -9.1364, "Finish at the river.")`;

export const webGroup: ExtraGroup = {
  name: "Maps, media and sandbox",
  notes: [
    "Map and ImageSearch fetch through the BB server (OpenStreetMap, Photon, Wikimedia Commons). The user can turn web lookups off; then they say so instead.",
    "Map: give lat and lng when you know them; names alone are looked up and can miss. Pass null to skip an optional argument, e.g. MapPlace(\"Alfama, Lisbon\", null, null, \"Walk\").",
    "App: the page has no network (no CDN scripts, fonts, fetch or remote images), forms do not submit, alert and confirm do nothing, and storage does not persist. Style with var(--foreground), var(--muted-foreground), var(--border), var(--primary), var(--card) and var(--font-sans). In a click handler, bbui.send(text) sends text as the user's message. Use ' inside the HTML and \\n for line breaks.",
    "Shader: one pass, no textures. Size by iResolution; the user can pause it.",
  ],
  components: [MapDef, MapPlaceDef, ImageSearchDef, AppDef, ShaderDef],
  examples: {
    Map: MAP_EXAMPLE,
    MapPlace: MAP_EXAMPLE,
    ImageSearch: String.raw`root = Stack([intro, photo])
intro = TextContent("Sample: what a sea stack looks like.")
photo = ImageSearch("sea stack at Old Harry Rocks", "Chalk sea stacks off a green headland", "wide")`,
    App: String.raw`root = Stack([app])
app = App("<style>\n  .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }\n  input { width: 80px; }\n  output { font-weight: 600; color: var(--primary); }\n  button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--foreground); }\n</style>\n<div class='row'><label for='bill'>Bill</label><input id='bill' type='number' value='84'></div>\n<div class='row'><label for='people'>People</label><input id='people' type='number' value='3' min='1'></div>\n<div class='row'><label for='tip'>Tip %</label><input id='tip' type='number' value='15'></div>\n<p>Each pays <output id='each'></output></p>\n<button id='share' type='button'>Send this split to the chat</button>\n<script>\n  const read = (id) => Number(document.getElementById(id).value) || 0;\n  function update() {\n    const each = (read('bill') * (1 + read('tip') / 100)) / Math.max(1, read('people'));\n    document.getElementById('each').textContent = each.toFixed(2);\n    return each;\n  }\n  document.querySelectorAll('input').forEach((input) => input.addEventListener('input', update));\n  document.getElementById('share').addEventListener('click', () => bbui.send('Split: ' + update().toFixed(2) + ' each'));\n  update();\n</script>", "Sample: tip splitter")`,
    Shader: String.raw`root = Stack([shader])
shader = Shader("void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;\n  float r = length(uv);\n  float wave = 0.5 + 0.5 * cos(18.0 * r - iTime * 2.0);\n  vec3 deep = vec3(0.06, 0.08, 0.14);\n  vec3 light = vec3(0.35, 0.6, 0.95);\n  fragColor = vec4(mix(deep, light, wave * smoothstep(0.7, 0.0, r)), 1.0);\n}", "Sample: ripples")`,
  },
};
