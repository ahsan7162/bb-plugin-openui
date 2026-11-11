import { test } from "node:test";
import assert from "node:assert/strict";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  changeRows,
  commitsView,
  environmentRow,
  matchesPath,
  MAX_INLINE_CHARS,
  NOT_GIT,
  readChanges,
  readCommits,
  readEnvironments,
  readPatch,
  readPullRequest,
  resolveTarget,
  type GitFile,
  type Workspace,
} from "./project";

// Shaped like `bb git status <env> --json` on a feature branch.
const workspace: Workspace = {
  checkout: { kind: "branch", branchName: "fix/names", headSha: "dd540cb56147801d7499be67d44ba8120251425b" },
  branch: { currentBranch: "fix/names", defaultBranch: "master" },
  workingTree: { insertions: 3, deletions: 1, fileCount: 2 },
  mergeBase: {
    mergeBaseBranch: "master",
    aheadCount: 2,
    behindCount: 1,
    commits: [
      { sha: "aaaa111", shortSha: "aaaa111", subject: "First", authorName: "Ana", authoredAt: 1 },
      { sha: "bbbb222", shortSha: "bbbb222", subject: "Second", authorName: "Ana", authoredAt: 2 },
    ],
  },
};
const file = (path: string, extra: Partial<GitFile> = {}): GitFile => ({
  path,
  previousPath: null,
  changeKind: "modified",
  additions: 2,
  deletions: 2,
  binary: false,
  origin: "tracked",
  loadMode: "auto",
  revision: `rev-${path}`,
  ...extra,
});

test("targets: branch work by default, uncommitted on the base branch, commits by sha", () => {
  assert.deepEqual(resolveTarget(undefined, workspace).target, { type: "all", mergeBaseBranch: "master" });
  assert.deepEqual(resolveTarget("uncommitted", workspace).target, { type: "uncommitted" });
  const onBase = { ...workspace, checkout: { kind: "branch", branchName: "master" } };
  assert.deepEqual(resolveTarget(undefined, onBase).target, { type: "uncommitted" });
  assert.deepEqual(resolveTarget(undefined, { ...workspace, checkout: { kind: "detached", headSha: "x" } }).target, { type: "uncommitted" });
  const commit = resolveTarget("BBBB", workspace);
  assert.deepEqual(commit.target, { type: "commit", sha: "bbbb" });
  assert.deepEqual(commit.scope, { kind: "commit", sha: "bbbb222", subject: "Second" });
});

test("path filters: exact, folder, glob", () => {
  assert.ok(matchesPath("src/a.ts", "src/a.ts"));
  assert.ok(matchesPath("src/a.ts", "src"));
  assert.ok(matchesPath("src/a.ts", "src/"));
  assert.ok(!matchesPath("srcx/a.ts", "src"));
  assert.ok(matchesPath("src/deep/a.ts", "src/**/*.ts"));
  assert.ok(matchesPath("src/a.ts", "src/**/*.ts"));
  assert.ok(matchesPath("docs/readme.md", "*.md"));
  assert.ok(!matchesPath("src/a.tsx", "*.ts"));
  assert.ok(!matchesPath("a.ts", "a.t?"), "? is literal, not a wildcard");
});

test("change rows: filtered, inline patches within budget, the rest on demand", () => {
  const big = "x".repeat(MAX_INLINE_CHARS);
  const { files, total } = changeRows(
    [file("src/a.ts"), file("src/b.ts"), file("img.png", { binary: true }), file("old.ts", { previousPath: "src/old.ts", changeKind: "renamed" }), file("README.md")],
    [
      { path: "src/a.ts", patch: big, truncated: false },
      { path: "src/b.ts", patch: "small", truncated: true },
      { path: "img.png", patch: "bin", truncated: false },
    ],
    ["src"],
  );
  assert.equal(total, 3);
  assert.deepEqual(files.map((f) => f.path), ["src/a.ts", "src/b.ts", "old.ts"]);
  assert.equal(files[0]!.patch, big);
  assert.equal(files[1]!.patch, null, "over budget once a.ts is inline");
  assert.equal(changeRows([file("img.png", { binary: true })], [{ path: "img.png", patch: "bin", truncated: false }], undefined).files[0]!.patch, null);
});

test("commits newest first, limited", () => {
  const view = commitsView(workspace, 1);
  assert.ok(view.ok);
  assert.deepEqual(view.commits.map((c) => c.subject), ["Second"]);
  assert.equal(view.total, 2);
  assert.equal(view.ahead, 2);
});

const env = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  projectId: "proj_1",
  branchName: "fix/names",
  isGitRepo: true,
  isWorktree: true,
  status: "ready" as const,
  updatedAt: 1,
  ...extra,
});

test("environment rows say why figures are missing", () => {
  const row = environmentRow(env("env_a"), { outcome: "available", workspace }, { outcome: "absent" }, "env_a");
  assert.deepEqual([row.current, row.changes, row.ahead, row.note, row.pullRequest], [true, { files: 2, additions: 3, deletions: 1 }, 2, null, null]);
  assert.equal(environmentRow(env("env_b", { isGitRepo: false }), undefined, undefined, null).note, "Not a git checkout");
  assert.equal(environmentRow(env("env_c"), null, null, null).note, "Git status unavailable");
  assert.equal(
    environmentRow(env("env_d"), { outcome: "unavailable", failure: { code: "path_not_found", message: "x" } }, null, null).note,
    "The workspace folder is gone",
  );
});

// A fake bb.sdk: one thread on env_a in proj_1; bb--git and bb--github-pr-status answer from fixtures.
function fakeSdk(calls: { pluginId: string; method: string; input: unknown }[]) {
  const pr = {
    number: 7,
    title: "Fix names",
    url: "https://github.com/o/r/pull/7",
    state: "open",
    baseRefName: "master",
    headRefName: "fix/names",
    checks: { state: "failing", totalCount: 3, passedCount: 2, failedCount: 1, pendingCount: 0 },
    review: { state: "review_requested", reviewRequestCount: 1 },
    mergeability: { state: "mergeable" },
    attention: "checks_failed",
  };
  const sdk = {
    threads: {
      get: async ({ threadId }: { threadId: string }) => {
        if (threadId !== "thr_1") throw Object.assign(new Error("not found"), { status: 404 });
        return { projectId: "proj_1", environmentId: "env_a", deletedAt: null };
      },
    },
    environments: {
      get: async () => env("env_a"),
      list: async () => [env("env_a"), env("env_other", { projectId: "proj_2" }), env("env_b", { updatedAt: 5, isGitRepo: false })],
    },
    plugins: {
      callRpc: async ({ pluginId, method, input, outputSchema }: { pluginId: string; method: string; input: unknown; outputSchema: { parse(v: unknown): unknown } }) => {
        calls.push({ pluginId, method, input });
        const keys = (input as { keys?: string[] }).keys ?? [];
        const answer =
          method === "status"
            ? Object.fromEntries(keys.map((k) => [k, { outcome: "available", workspace }]))
            : method === "files"
              ? { outcome: "available", files: [file("src/a.ts")], truncated: false, shortstat: "", mergeBaseRef: null, initialPatches: [] }
              : method === "patches"
                ? Object.fromEntries(keys.map((k) => [k, { outcome: "available", patch: { path: "src/a.ts", patch: "@@ -1 +1 @@", truncated: false } }]))
                : Object.fromEntries(keys.map((k) => [k, { outcome: "available", pullRequest: { ...pr, extraField: true } }]));
        return outputSchema.parse(answer);
      },
    },
  };
  return sdk as unknown as BbPluginApi["sdk"];
}

test("changes and patches read only the reply thread's environment", async () => {
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const sdk = fakeSdk(calls);
  const changes = await readChanges(sdk, "thr_1", undefined, undefined);
  assert.ok(changes.ok);
  assert.equal(changes.files[0]!.patch, null);
  assert.deepEqual(calls[1], { pluginId: "bb--git", method: "files", input: { environmentId: "env_a", target: { type: "all", mergeBaseBranch: "master" }, ignoreWhitespace: false } });
  const patch = await readPatch(sdk, "thr_1", changes.target, "src/a.ts", "rev-src/a.ts");
  assert.deepEqual(patch, { ok: true, patch: "@@ -1 +1 @@", truncated: false });
  assert.deepEqual((calls[2]!.input as { keys: string[] }).keys, [JSON.stringify(["env_a", { type: "all", mergeBaseBranch: "master" }, false, "src/a.ts", "rev-src/a.ts"])]);
  assert.deepEqual(await readChanges(sdk, "thr_unknown", undefined, undefined), { ok: false, error: "BB has no such thread" });
});

test("pull request and environments map, other projects never appear", async () => {
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const sdk = fakeSdk(calls);
  const pr = await readPullRequest(sdk, "thr_1");
  assert.ok(pr.ok && pr.pullRequest !== null);
  assert.deepEqual(pr.pullRequest.checks, { state: "failing", passed: 2, failed: 1, pending: 0, total: 3 });
  const envs = await readEnvironments(sdk, "thr_1");
  assert.ok(envs.ok);
  assert.deepEqual(envs.environments.map((e) => e.id), ["env_a", "env_b"]);
  assert.equal(envs.environments[0]!.pullRequest?.number, 7);
  // Only the ready git environment is asked about.
  assert.deepEqual((calls.at(-1)!.input as { keys: string[] }).keys, ["env_a"]);
});

test("a plain folder is NOT_GIT, which the components show as a state", async () => {
  const sdk = fakeSdk([]);
  (sdk.environments as { get: unknown }).get = async () => env("env_a", { isGitRepo: false });
  assert.deepEqual(await readPullRequest(sdk, "thr_1"), { ok: false, error: NOT_GIT });
  assert.equal(NOT_GIT, "Not a git checkout");
  (sdk.plugins as { callRpc: unknown }).callRpc = async () => ({ env_a: { outcome: "not_applicable", reason: "non_git_environment", message: "x" } });
  assert.deepEqual(await readChanges(sdk, "thr_1", undefined, undefined), { ok: false, error: NOT_GIT });
});

test("a failing builtin plugin is a value, not a throw", async () => {
  const sdk = fakeSdk([]);
  (sdk.plugins as { callRpc: unknown }).callRpc = async () => {
    throw new Error("plugin bb--git is disabled");
  };
  assert.deepEqual(await readCommits(sdk, "thr_1", 10), { ok: false, error: "BB couldn't read the commits: plugin bb--git is disabled" });
  const envs = await readEnvironments(sdk, "thr_1");
  assert.ok(envs.ok);
  assert.equal(envs.environments[0]!.note, "Git status unavailable");
});

