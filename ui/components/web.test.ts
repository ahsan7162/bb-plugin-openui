import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CSP, SHADER_HEAD, VIEW, appDocument, compileErrors, findNetworkUse, fitView, project, readPlaces, routeGroups, shaderSource, tilesFor } from "./web";

test("project puts the world in one tile at zoom 0", () => {
  assert.deepEqual(project(0, 0, 0), { x: 128, y: 128 });
  const ne = project(85, 180, 0);
  assert.ok(ne.x === 256 && ne.y < 1);
});

test("fitView zooms to fit every place, capped for a single one", () => {
  const lisbon = [
    { lat: 38.6916, lng: -9.216 },
    { lat: 38.7139, lng: -9.1335 },
  ];
  const view = fitView(lisbon);
  const [a, b] = lisbon.map((p) => project(p.lat, p.lng, view.zoom));
  assert.ok(Math.abs(a!.x - b!.x) <= VIEW.w - 80 && view.zoom >= 11 && view.zoom <= 14, `zoom ${view.zoom}`);
  const further = lisbon.map((p) => project(p.lat, p.lng, view.zoom + 1));
  assert.ok(Math.abs(further[0]!.x - further[1]!.x) > VIEW.w - 80);
  assert.equal(fitView([{ lat: 51.5, lng: 0 }]).zoom, 16);
});

test("tilesFor covers the view, wraps x and stops at the poles", () => {
  const tiles = tilesFor({ zoom: 1, cx: 0, cy: 256 });
  assert.ok(tiles.every((t) => t.x >= 0 && t.x < 2 && t.y >= 0 && t.y < 2));
  assert.ok(tiles.some((t) => t.left < 0) && tiles.some((t) => t.left + 256 >= VIEW.w));
  assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
});

const node = (props: Record<string, unknown>) => ({ type: "element", typeName: "MapPlace", props });

test("readPlaces keeps names, carries the day forward and drops bad coordinates", () => {
  const places = readPlaces([node({ name: "A", lat: 1, lng: 2, day: 1 }), node({ name: "B", lat: 200, lng: 2 }), node({ name: " " }), null, node({ name: "C", day: "Sat 14" })]);
  assert.deepEqual(
    places.map((p) => [p.name, p.day, p.given]),
    [
      ["A", "Day 1", { lat: 1, lng: 2 }],
      ["B", "Day 1", null],
      ["C", "Sat 14", null],
    ],
  );
  assert.deepEqual(readPlaces(undefined), []);
  assert.deepEqual(
    routeGroups(places).map((g) => g.indexes),
    [[0, 1], [2]],
  );
});

test("findNetworkUse flags what loads from the network, with lines", () => {
  const page = [
    "<script src='https://cdn.example/x.js'></script>",
    "<link rel='stylesheet' href='https://fonts.example/a.css'>",
    "<img src='https://example.com/a.png'>",
    "<style>body { background: url(https://example.com/bg.png) }</style>",
    "<script>fetch('/api'); const ws = new WebSocket('wss://x');</script>",
    "<a href='https://example.com'>out</a>",
  ].join("\n");
  assert.deepEqual(
    findNetworkUse(page).map((f) => f.line),
    [1, 2, 3, 4, 5, 5, 6],
  );
});

test("findNetworkUse lets offline pages through", () => {
  const page = [
    "<!-- <script src='https://cdn.example/x.js'></script> -->",
    "<svg xmlns='http://www.w3.org/2000/svg'><use href='#dot'/><rect fill='url(#g)'/></svg>",
    "<img src='data:image/png;base64,AAAA'>",
    "<script>const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); if (location.hash == '#a') {}</script>",
  ].join("\n");
  assert.deepEqual(findNetworkUse(page), []);
});

test("appDocument puts the CSP and theme ahead of the page and keeps one doctype", () => {
  const doc = appDocument("<!DOCTYPE html><html><body>Hi</body></html>", { "--foreground": "oklch(20% 0 0)", "--card": "red;}</style><script>x" });
  assert.ok(doc.startsWith("<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\""));
  assert.ok(doc.includes(APP_CSP) && APP_CSP.includes("default-src 'none'") && APP_CSP.includes("connect-src 'none'"));
  assert.equal(doc.match(/<!doctype/gi)!.length, 1);
  assert.ok(doc.includes("--foreground:oklch(20% 0 0);"));
  assert.ok(!doc.includes("</style><script>x"));
});

test("shaderSource wraps mainImage and compile errors map to the agent's lines", () => {
  const code = "#version 300 es\nvoid mainImage(out vec4 c, in vec2 p) {\n  c = vec4(oops);\n}";
  const source = shaderSource(code);
  assert.ok(source.startsWith(SHADER_HEAD) && source.split("#version").length === 2);
  const head = SHADER_HEAD.split("\n").length - 1;
  // The browser counts lines in the whole program; line 3 of the code is head + 3.
  assert.equal(source.split("\n")[head + 2], "  c = vec4(oops);");
  const log = `ERROR: 0:${head + 3}: 'oops' : undeclared identifier\nERROR: 0:${head + 9}: 'main' : redefinition\nsomething else\n`;
  assert.deepEqual(compileErrors(log, 4), [
    { line: 3, message: "'oops' : undeclared identifier" },
    { line: null, message: "'main' : redefinition" },
    { line: null, message: "something else" },
  ]);
});
