import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, USER_AGENT, createWeb, get, pickCommonsPhoto, plainText, readLeadImage, readPhoton, sniffImage, type Fetcher } from "./web";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

/** A fetch that answers from a table by URL prefix and records what was asked. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const route = Object.keys(routes).find((prefix) => String(url).startsWith(prefix));
    return route ? routes[route]!() : new Response("no", { status: 404 });
  }) as Fetcher;
  return { fetcher, calls };
}
const options = { accept: "*/*", maxBytes: 100, timeoutMs: 1000 };

test("get refuses anything but https on the allowed hosts", async () => {
  const { fetcher, calls } = fakeFetch({});
  for (const url of ["http://tile.openstreetmap.org/1/0/0.png", "https://evil.example/x", "https://tile.openstreetmap.org:8443/x", "https://user@en.wikipedia.org/", "not a url"]) {
    assert.equal((await get(url, options, fetcher)).ok, false, url);
  }
  assert.equal(calls.length, 0);
});

test("get sends the plugin's User-Agent, no redirects, and caps the body", async () => {
  const { fetcher, calls } = fakeFetch({
    "https://photon.komoot.io/small": () => new Response("{}", { status: 200 }),
    "https://photon.komoot.io/big": () => new Response("x".repeat(500), { status: 200 }),
    "https://photon.komoot.io/moved": () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
  });
  const small = await get("https://photon.komoot.io/small", options, fetcher);
  assert.ok(small.ok && small.body.toString() === "{}");
  const headers = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(headers["user-agent"], USER_AGENT);
  assert.equal(calls[0]!.init!.redirect, "manual");
  assert.doesNotMatch(USER_AGENT, /@|user/i);
  assert.equal((await get("https://photon.komoot.io/big", options, fetcher)).ok, false);
  assert.equal((await get("https://photon.komoot.io/moved", options, fetcher)).ok, false);
});

test("sniffImage reads the bytes, not the header", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("<html>")), null);
});

test("plainText strips Commons HTML and decodes entities", () => {
  assert.equal(plainText('<a href="//x">Jane &amp; Joe</a>&#32;<span>(talk)</span>'), "Jane & Joe (talk)");
  assert.equal(plainText(undefined), "");
});

test("readPhoton and readLeadImage pick the first answer or null", () => {
  assert.deepEqual(readPhoton({ features: [{ geometry: { coordinates: [-9.13, 38.71] } }] }), { lat: 38.71, lng: -9.13 });
  assert.equal(readPhoton({ features: [] }), null);
  assert.equal(readPhoton({ features: [{ geometry: { coordinates: [200, 10] } }] }), null);
  assert.equal(readLeadImage({ query: { pages: [{ pageimage: "Tower.jpg" }] } }), "Tower.jpg");
  assert.equal(readLeadImage({ query: { pages: [{ missing: true }] } }), null);
});

const page = (index: number, licence: string | undefined, extra: Record<string, { value: string }> = {}) => ({
  index,
  title: `File:Photo ${index}.jpg`,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/${index}.jpg`,
      thumbwidth: 1024,
      thumbheight: 683,
      mime: "image/jpeg",
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Photo_${index}.jpg`,
      extmetadata: { ...(licence ? { LicenseShortName: { value: licence } } : {}), Artist: { value: "<b>Ann</b>" }, ...extra },
    },
  ],
});

test("pickCommonsPhoto takes the first creditable free photo in search order", () => {
  const found = pickCommonsPhoto({ query: { pages: [page(3, "CC BY 4.0"), page(1, undefined), page(2, "CC BY-SA 4.0", { NonFree: { value: "true" } })] } });
  assert.equal(found?.thumb, "https://upload.wikimedia.org/3.jpg");
  assert.equal(found?.artist, "Ann");
  assert.equal(found?.title, "Photo 3");
  assert.equal(pickCommonsPhoto({ query: { pages: [page(1, undefined)] } }), null);
  assert.equal(pickCommonsPhoto(undefined), null);
});

test("MemoryCache expires entries and evicts the oldest past its size", () => {
  let now = 0;
  const cache = new MemoryCache<string>(10, () => now);
  cache.set("a", "A", 4, 100);
  cache.set("b", "B", 4, 100);
  assert.equal(cache.get("a"), "A"); // a is now the newest
  cache.set("c", "C", 4, 100);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A");
  now = 200;
  assert.equal(cache.get("c"), undefined);
});

test("createWeb fetches nothing while the setting is off", async () => {
  const { fetcher, calls } = fakeFetch({});
  const web = createWeb({ get: async () => ({ webLookups: false }) }, fetcher);
  const results = await Promise.all([web.geocode({ name: "Lisbon" }), web.tile({ z: 1, x: 0, y: 0 }), web.imageSearch({ query: "fox" }), web.wikiPhoto({ title: "Fox" })]);
  for (const r of results) assert.deepEqual({ ok: r.ok, off: "off" in r && r.off }, { ok: false, off: true });
  assert.equal(calls.length, 0);
});

test("createWeb caches answers and returns images as data URLs", async () => {
  const { fetcher, calls } = fakeFetch({
    "https://tile.openstreetmap.org/": () => new Response(PNG, { status: 200 }),
    "https://commons.wikimedia.org/": () => new Response(JSON.stringify({ query: { pages: [page(1, "CC0")] } }), { status: 200 }),
    "https://upload.wikimedia.org/": () => new Response(JPEG, { status: 200 }),
  });
  const web = createWeb({ get: async () => ({ webLookups: true }) }, fetcher);
  const tile = await web.tile({ z: 2, x: 1, y: 3 });
  assert.ok(tile.ok && tile.dataUrl.startsWith("data:image/png;base64,"));
  await web.tile({ z: 2, x: 1, y: 3 });
  assert.equal(calls.filter((c) => c.url.includes("openstreetmap")).length, 1);
  assert.equal((await web.tile({ z: 2, x: 4, y: 0 })).ok, false);
  const photo = await web.imageSearch({ query: "  Red   fox " });
  assert.ok(photo.ok && photo.photo.src.startsWith("data:image/jpeg;base64,") && photo.photo.licence === "CC0");
  await web.imageSearch({ query: "red fox" });
  assert.equal(calls.filter((c) => c.url.includes("commons")).length, 1);
});
