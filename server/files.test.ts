import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAttempts } from "./files";

const roots = { workspace: { path: "/work/repo", hostId: "h" }, storage: { path: "/store/thr", hostId: "h" } };
const targets = (p: string) => resolveAttempts(p, roots).map((a) => a.target);

test("paths resolve inside the thread's roots only", () => {
  assert.deepEqual(targets("src/a.ts"), ["/work/repo/src/a.ts"]);
  assert.deepEqual(targets("$BB_THREAD_STORAGE/tests.json"), ["/store/thr/tests.json"]);
  assert.deepEqual(targets("/store/thr/x.log"), ["/store/thr/x.log"]);
  assert.deepEqual(targets("/tmp/out.txt"), ["/tmp/out.txt"]);
});

test("escapes are refused", () => {
  assert.deepEqual(targets("../other/secret"), []);
  assert.deepEqual(targets("$BB_THREAD_STORAGE/../thr2/x"), []);
  assert.deepEqual(targets("/etc/passwd"), []);
  assert.deepEqual(targets("/work/repo-evil/x"), []);
  assert.deepEqual(resolveAttempts("src/a.ts", { workspace: null, storage: null }), []);
});
