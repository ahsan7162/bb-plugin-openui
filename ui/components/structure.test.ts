import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, diffPath, diffStats, imageSource, jsonCopyText, jsonPath, jsonSummary, parseJsonValue, percent, shortUrl, webUrl } from "./structure/logic";

test("paths merge into folders in the order given; objects nest", () => {
  const tree = buildTree(["src/a.ts", "src/b/c.ts", "README.md", "docs/", { label: "Notes", note: "new", children: ["x/y.md"] }, 7, null]);
  assert.deepEqual(
    tree.map((n) => [n.label, n.children?.length ?? null, n.mono]),
    [["src", 2, true], ["README.md", null, true], ["docs", 0, true], ["Notes", 1, false]],
  );
  assert.equal(tree[0]!.children![1]!.children![0]!.label, "c.ts");
  assert.equal(tree[3]!.note, "new");
  assert.equal(tree[3]!.children![0]!.children![0]!.label, "y.md");
  assert.equal(new Set([tree[0]!.key, tree[0]!.children![0]!.key, tree[3]!.key]).size, 3);
  assert.deepEqual(buildTree(undefined), []);
});

test("json values, paths and copy text", () => {
  assert.deepEqual(parseJsonValue('{"a":[1]}'), { a: [1] });
  assert.equal(parseJsonValue("{not json"), "{not json");
  assert.equal(parseJsonValue("plain"), "plain");
  assert.equal(jsonPath([]), "$");
  assert.equal(jsonPath(["data", "lines", 0, "request id"]), '$.data.lines[0]["request id"]');
  assert.equal(jsonSummary([1, 2, 3]), "3 items");
  assert.equal(jsonSummary({ a: 1 }), "1 key");
  assert.equal(jsonCopyText("hi"), "hi");
  assert.equal(jsonCopyText({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(jsonCopyText(undefined), "null");
});

test("diff path and counts", () => {
  const patch = "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n+d";
  assert.equal(diffPath(patch), "src/x.ts");
  assert.equal(diffPath("--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-x"), "old.py");
  assert.equal(diffPath("@@ -1 +1 @@\n-a\n+b", "TypeScript"), "file.ts");
  assert.equal(diffPath("@@ -1 +1 @@", "go"), "file.go");
  assert.equal(diffPath("@@ -1 +1 @@", "not a lang"), "file.txt");
  assert.deepEqual(diffStats(patch), { added: 2, removed: 1 });
});

test("only web links and https or thread-path images get through", () => {
  assert.equal(webUrl("javascript:alert(1)"), null);
  assert.equal(webUrl(" https://example.com/a ")?.hostname, "example.com");
  assert.equal(webUrl("not a url"), null);
  assert.equal(shortUrl(webUrl("https://www.example.com/a/b/")!), "example.com/a/b");
  assert.deepEqual(imageSource("https://x.org/a.png"), { kind: "url", url: "https://x.org/a.png" });
  assert.deepEqual(imageSource("shots/a.png"), { kind: "file", path: "shots/a.png" });
  assert.equal(imageSource("http://x.org/a.png"), null);
  assert.equal(imageSource("data:image/png;base64,AA"), null);
  assert.equal(imageSource(""), null);
  assert.equal(percent(120), 100);
  assert.equal(percent(Number.NaN), 50);
});
