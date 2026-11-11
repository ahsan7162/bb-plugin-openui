// Live git state of the reply's own thread for the "BB project" components
// (Changes, Commits, PullRequest, Environments). Read-only. Every call starts
// from the reply's thread id: its environment, or its project's environments;
// a client never names an environment. This SDK has no git reads of its own,
// so they go through BB's builtin plugins: bb--git (status, changed files,
// patches) and bb--github-pr-status (pull requests). Failures are values.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];
const GIT = "bb--git";
const PULL_REQUESTS = "bb--github-pr-status";

export const MAX_FILES = 300;
/** Patch text sent inline with the file list, in total; the rest load when opened. */
export const MAX_INLINE_CHARS = 400_000;
export const MAX_PATCH_CHARS = 1_000_000;
export const MAX_ENVIRONMENTS = 12;
export const SHA = /^[0-9a-f]{4,40}$/i;

export type Failure = { ok: false; error: string };
/** The failure for a plain folder; the components show it as a state, not an error (ui/components/project.tsx matches it). */
export const NOT_GIT = "Not a git checkout";
const fail = (error: string): Failure => ({ ok: false, error });
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** A diff target as bb--git takes it. */
export const gitTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string().min(1).max(256) }),
  z.object({ type: z.literal("commit"), sha: z.string().regex(SHA) }),
]);
export type GitTarget = z.infer<typeof gitTargetSchema>;

// The parts of the builtin plugins' answers read here (z.object drops the rest).
const notRead = z.object({
  outcome: z.enum(["not_applicable", "unavailable", "failed"]),
  message: z.string().optional(),
  failure: z.object({ code: z.string(), message: z.string() }).optional(),
});
type NotRead = z.infer<typeof notRead>;
const counts = z.object({ insertions: z.number(), deletions: z.number(), fileCount: z.number() });
const workspaceSchema = z.object({
  checkout: z.object({ kind: z.string(), branchName: z.string().nullable().optional(), headSha: z.string().nullable().optional() }),
  branch: z.object({ currentBranch: z.string().nullable(), defaultBranch: z.string() }),
  workingTree: counts,
  mergeBase: z
    .object({
      mergeBaseBranch: z.string(),
      aheadCount: z.number(),
      behindCount: z.number(),
      commits: z.array(z.object({ sha: z.string(), shortSha: z.string(), subject: z.string(), authorName: z.string(), authoredAt: z.number() })),
    })
    .nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
const statusRow = z.union([z.object({ outcome: z.literal("available"), workspace: workspaceSchema }), notRead]);
type StatusRow = z.infer<typeof statusRow>;
const fileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: z.string(),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  origin: z.string(),
  loadMode: z.string(),
  revision: z.string(),
});
export type GitFile = z.infer<typeof fileSchema>;
const patchSchema = z.object({ path: z.string(), patch: z.string(), truncated: z.boolean() });
export type GitPatch = z.infer<typeof patchSchema>;
const filesAnswer = z.union([
  z.object({ outcome: z.literal("available"), files: z.array(fileSchema), truncated: z.boolean(), initialPatches: z.array(patchSchema) }),
  notRead,
]);
const patchRow = z.union([z.object({ outcome: z.literal("available"), patch: patchSchema }), notRead]);
const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  checks: z.object({ state: z.string(), totalCount: z.number(), passedCount: z.number(), failedCount: z.number(), pendingCount: z.number() }),
  review: z.object({ state: z.string(), reviewRequestCount: z.number() }),
  mergeability: z.object({ state: z.string() }),
  attention: z.string(),
});
export type GitHubPullRequest = z.infer<typeof pullRequestSchema>;
const pullRequestRow = z.union([
  z.object({ outcome: z.literal("available"), pullRequest: pullRequestSchema }),
  z.object({ outcome: z.literal("absent") }),
  z.object({ outcome: z.literal("unavailable"), message: z.string() }),
]);
type PullRequestRow = z.infer<typeof pullRequestRow>;

// What the components get.
export type Scope =
  | { kind: "branch"; branch: string; base: string }
  | { kind: "uncommitted"; branch: string | null }
  | { kind: "commit"; sha: string; subject: string | null };
export type ChangeRow = {
  path: string;
  previousPath: string | null;
  kind: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  revision: string;
  /** Inline patch; null = load it with project_patch (unless binary or tooLarge). */
  patch: string | null;
  patchTruncated: boolean;
  tooLarge: boolean;
};
export type ChangesResult = { ok: true; scope: Scope; target: GitTarget; files: ChangeRow[]; total: number; truncated: boolean } | Failure;
export type PatchResult = { ok: true; patch: string; truncated: boolean } | Failure;
export type CommitRow = { sha: string; shortSha: string; subject: string; author: string; authoredAt: number };
export type CommitsResult =
  | { ok: true; branch: string | null; base: string | null; ahead: number; behind: number; commits: CommitRow[]; total: number }
  | Failure;
export type PullRequestView = {
  number: number;
  title: string;
  url: string;
  state: string;
  base: string;
  head: string;
  checks: { state: string; passed: number; failed: number; pending: number; total: number };
  review: { state: string; requests: number };
  mergeability: string;
  attention: string;
};
export type PullRequestResult = { ok: true; branch: string | null; pullRequest: PullRequestView | null } | Failure;
export type EnvironmentRow = {
  id: string;
  name: string | null;
  branch: string | null;
  current: boolean;
  kind: "worktree" | "checkout" | "folder";
  /** Uncommitted work. */
  changes: { files: number; additions: number; deletions: number } | null;
  ahead: number | null;
  behind: number | null;
  /** Why there are no git figures, in words. */
  note: string | null;
  pullRequest: { number: number; title: string; state: string; url: string } | null;
};
export type EnvironmentsResult = { ok: true; environments: EnvironmentRow[]; total: number } | Failure;

/** BB's reason a checkout couldn't be read, in words. */
export function notReadMessage(answer: NotRead): string {
  const code = answer.failure?.code;
  if (answer.outcome === "not_applicable" || code === "not_git_repo" || code === "workspace_type_mismatch") return NOT_GIT;
  if (answer.failure?.code === "path_not_found") return "The workspace folder is gone";
  return answer.failure?.message ?? answer.message ?? "BB couldn't read the checkout";
}

/** What to diff: a commit sha, the uncommitted work, or (default) the branch's work since its merge base, uncommitted included. */
export function resolveTarget(requested: string | undefined, workspace: Workspace): { target: GitTarget; scope: Scope } {
  if (requested !== undefined && SHA.test(requested)) {
    const sha = requested.toLowerCase();
    const commit = workspace.mergeBase?.commits.find((c) => c.sha.startsWith(sha)) ?? null;
    return { target: { type: "commit", sha }, scope: { kind: "commit", sha: commit?.sha ?? sha, subject: commit?.subject ?? null } };
  }
  const branch = workspace.checkout.kind === "branch" ? (workspace.checkout.branchName ?? null) : null;
  const base = workspace.mergeBase?.mergeBaseBranch ?? null;
  // On the base branch itself (or with no merge base) the branch's work is its uncommitted work.
  if (requested === "uncommitted" || branch === null || base === null || branch === base) {
    return { target: { type: "uncommitted" }, scope: { kind: "uncommitted", branch } };
  }
  return { target: { type: "all", mergeBaseBranch: base }, scope: { kind: "branch", branch, base } };
}

const GLOB: Record<string, string> = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*" };

/** `filter` is an exact path, a folder ("src" or "src/") or a glob ("src/**\/*.ts", "*.md"). */
export function matchesPath(path: string, filter: string): boolean {
  if (!filter.includes("*")) {
    const folder = filter.replace(/\/+$/, "");
    return path === folder || path.startsWith(`${folder}/`);
  }
  const pattern = filter
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => GLOB[part] ?? part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("");
  // A pattern without a folder matches the file name anywhere, as git does.
  return new RegExp(`^${filter.includes("/") ? "" : "(?:.*/)?"}${pattern}$`).test(path);
}

/** The listed files (filtered, capped) with inline patches up to the budget. */
export function changeRows(files: readonly GitFile[], patches: readonly GitPatch[], filters: readonly string[] | undefined) {
  const wanted =
    filters === undefined || filters.length === 0
      ? files
      : files.filter((f) => filters.some((p) => matchesPath(f.path, p) || (f.previousPath !== null && matchesPath(f.previousPath, p))));
  const inline = new Map(patches.map((p) => [p.path, p]));
  let budget = MAX_INLINE_CHARS;
  const rows = wanted.slice(0, MAX_FILES).map((f): ChangeRow => {
    const found = f.binary ? undefined : inline.get(f.path);
    const fits = found !== undefined && found.patch.length <= budget;
    if (fits) budget -= found.patch.length;
    return {
      path: f.path,
      previousPath: f.previousPath,
      kind: f.changeKind,
      additions: f.additions,
      deletions: f.deletions,
      binary: f.binary,
      untracked: f.origin === "untracked",
      revision: f.revision,
      patch: fits ? found.patch : null,
      patchTruncated: fits && found.truncated,
      tooLarge: f.loadMode === "too_large",
    };
  });
  return { files: rows, total: wanted.length };
}

/** The branch's commits since its merge base, newest first (bb--git lists them oldest first). */
export function commitsView(workspace: Workspace, limit: number): CommitsResult {
  const base = workspace.mergeBase;
  const all = [...(base?.commits ?? [])].reverse();
  return {
    ok: true,
    branch: workspace.branch.currentBranch,
    base: base?.mergeBaseBranch ?? null,
    ahead: base?.aheadCount ?? 0,
    behind: base?.behindCount ?? 0,
    commits: all.slice(0, limit).map((c) => ({ sha: c.sha, shortSha: c.shortSha, subject: c.subject, author: c.authorName, authoredAt: c.authoredAt })),
    total: all.length,
  };
}

export function pullRequestView(pr: GitHubPullRequest): PullRequestView {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    base: pr.baseRefName,
    head: pr.headRefName,
    checks: { state: pr.checks.state, passed: pr.checks.passedCount, failed: pr.checks.failedCount, pending: pr.checks.pendingCount, total: pr.checks.totalCount },
    review: { state: pr.review.state, requests: pr.review.reviewRequestCount },
    mergeability: pr.mergeability.state,
    attention: pr.attention,
  };
}

type EnvironmentEntry = Pick<
  Awaited<ReturnType<Sdk["environments"]["get"]>>,
  "id" | "name" | "projectId" | "branchName" | "isGitRepo" | "isWorktree" | "status" | "updatedAt"
>;

/** One environment's row; `status` null = bb--git couldn't be asked, undefined = not asked. */
export function environmentRow(
  env: EnvironmentEntry,
  status: StatusRow | null | undefined,
  pr: PullRequestRow | null | undefined,
  currentId: string | null,
): EnvironmentRow {
  const workspace = status?.outcome === "available" ? status.workspace : null;
  const note = !env.isGitRepo
    ? NOT_GIT
    : env.status !== "ready"
      ? `Environment is ${env.status}`
      : workspace !== null
        ? null
        : status === null || status === undefined
          ? "Git status unavailable"
          : notReadMessage(status as NotRead);
  return {
    id: env.id,
    name: env.name,
    branch: workspace?.branch.currentBranch ?? env.branchName,
    current: env.id === currentId,
    kind: env.isWorktree ? "worktree" : env.isGitRepo ? "checkout" : "folder",
    changes: workspace && { files: workspace.workingTree.fileCount, additions: workspace.workingTree.insertions, deletions: workspace.workingTree.deletions },
    ahead: workspace?.mergeBase?.aheadCount ?? null,
    behind: workspace?.mergeBase?.behindCount ?? null,
    note,
    pullRequest: pr?.outcome === "available" ? { number: pr.pullRequest.number, title: pr.pullRequest.title, state: pr.pullRequest.state, url: pr.pullRequest.url } : null,
  };
}

// SDK glue: thin, every path returns a value.

async function ownThread(sdk: Sdk, threadId: string) {
  let thread;
  try {
    thread = await sdk.threads.get({ threadId });
  } catch {
    return fail("BB has no such thread");
  }
  if (thread.deletedAt !== null) return fail("This thread was deleted");
  return { ok: true as const, projectId: thread.projectId, environmentId: thread.environmentId };
}

async function ownEnvironment(sdk: Sdk, threadId: string) {
  const own = await ownThread(sdk, threadId);
  if (!own.ok) return own;
  if (own.environmentId === null) return fail("This thread has no environment");
  return { ok: true as const, environmentId: own.environmentId };
}

function keyed<T extends z.ZodType>(sdk: Sdk, pluginId: string, method: string, keys: string[], row: T) {
  return sdk.plugins.callRpc({ pluginId, method, input: { keys }, outputSchema: z.record(z.string(), row) });
}

async function workspaceOf(sdk: Sdk, environmentId: string) {
  const rows = await keyed(sdk, GIT, "status", [environmentId], statusRow);
  const row = rows[environmentId];
  if (row === undefined) return fail("BB's Git plugin returned no status");
  if (row.outcome !== "available") return fail(notReadMessage(row));
  return { ok: true as const, workspace: row.workspace };
}

export async function readChanges(sdk: Sdk, threadId: string, requested: string | undefined, paths: string[] | undefined): Promise<ChangesResult> {
  try {
    const own = await ownEnvironment(sdk, threadId);
    if (!own.ok) return own;
    const status = await workspaceOf(sdk, own.environmentId);
    if (!status.ok) return status;
    const { target, scope } = resolveTarget(requested, status.workspace);
    const answer = await sdk.plugins.callRpc({
      pluginId: GIT,
      method: "files",
      input: { environmentId: own.environmentId, target, ignoreWhitespace: false },
      outputSchema: filesAnswer,
    });
    if (answer.outcome !== "available") return fail(notReadMessage(answer));
    const { files, total } = changeRows(answer.files, answer.initialPatches, paths);
    return { ok: true, scope, target, files, total, truncated: answer.truncated || total > files.length };
  } catch (cause) {
    return fail(`BB couldn't read the changes: ${message(cause)}`);
  }
}

export async function readPatch(sdk: Sdk, threadId: string, target: GitTarget, path: string, revision: string): Promise<PatchResult> {
  try {
    const own = await ownEnvironment(sdk, threadId);
    if (!own.ok) return own;
    // bb--git's patch key (its contract's gitPatchKey).
    const key = JSON.stringify([own.environmentId, target, false, path, revision]);
    const row = (await keyed(sdk, GIT, "patches", [key], patchRow))[key];
    if (row === undefined) return fail("The file is no longer in this diff");
    if (row.outcome !== "available") return fail(notReadMessage(row));
    const { patch, truncated } = row.patch;
    return { ok: true, patch: patch.slice(0, MAX_PATCH_CHARS), truncated: truncated || patch.length > MAX_PATCH_CHARS };
  } catch (cause) {
    return fail(`BB couldn't read the diff: ${message(cause)}`);
  }
}

export async function readCommits(sdk: Sdk, threadId: string, limit: number): Promise<CommitsResult> {
  try {
    const own = await ownEnvironment(sdk, threadId);
    if (!own.ok) return own;
    const status = await workspaceOf(sdk, own.environmentId);
    return status.ok ? commitsView(status.workspace, limit) : status;
  } catch (cause) {
    return fail(`BB couldn't read the commits: ${message(cause)}`);
  }
}

export async function readPullRequest(sdk: Sdk, threadId: string): Promise<PullRequestResult> {
  try {
    const own = await ownEnvironment(sdk, threadId);
    if (!own.ok) return own;
    const env = await sdk.environments.get({ environmentId: own.environmentId });
    if (!env.isGitRepo) return fail(NOT_GIT);
    const row = (await keyed(sdk, PULL_REQUESTS, "pullRequests", [own.environmentId], pullRequestRow))[own.environmentId];
    if (row?.outcome === "unavailable") return fail(row.message);
    return { ok: true, branch: env.branchName, pullRequest: row?.outcome === "available" ? pullRequestView(row.pullRequest) : null };
  } catch (cause) {
    return fail(`BB couldn't read the pull request: ${message(cause)}`);
  }
}

export async function readEnvironments(sdk: Sdk, threadId: string): Promise<EnvironmentsResult> {
  try {
    const own = await ownThread(sdk, threadId);
    if (!own.ok) return own;
    const listed = (await sdk.environments.list({ projectId: own.projectId, limit: 200 })).filter(
      (env) => env.projectId === own.projectId && env.status !== "destroyed",
    );
    // This thread's environment first, then the most recently changed.
    listed.sort((a, b) => Number(b.id === own.environmentId) - Number(a.id === own.environmentId) || b.updatedAt - a.updatedAt);
    const shown = listed.slice(0, MAX_ENVIRONMENTS);
    const git = shown.filter((env) => env.isGitRepo && env.status === "ready").map((env) => env.id);
    const [status, pulls]: [Record<string, StatusRow> | null, Record<string, PullRequestRow> | null] =
      git.length === 0
        ? [{}, {}]
        : await Promise.all([
            keyed(sdk, GIT, "status", git, statusRow).catch(() => null),
            keyed(sdk, PULL_REQUESTS, "pullRequests", git, pullRequestRow).catch(() => null),
          ]);
    return {
      ok: true,
      environments: shown.map((env) => environmentRow(env, status === null ? null : status[env.id], pulls?.[env.id], own.environmentId)),
      total: listed.length,
    };
  } catch (cause) {
    return fail(`BB couldn't list the environments: ${message(cause)}`);
  }
}

// The rpc contract entries server.ts spreads into its rpcContract; inputs validated here.
const threadId = z.string().min(1).max(64);
export const projectMethods = {
  project_changes: {
    input: z.object({
      threadId,
      target: z.union([z.literal("uncommitted"), z.string().regex(SHA)]).optional(),
      paths: z.array(z.string().min(1).max(1024)).max(50).optional(),
    }),
    output: z.custom<ChangesResult>(),
  },
  project_patch: {
    input: z.object({
      threadId,
      target: gitTargetSchema,
      // Repository-relative, as bb--git lists it.
      path: z.string().min(1).max(1024).refine((p) => !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("\0"), "not a repository path"),
      revision: z.string().min(1).max(1024),
    }),
    output: z.custom<PatchResult>(),
  },
  project_commits: { input: z.object({ threadId, limit: z.number().int().min(1).max(100).optional() }), output: z.custom<CommitsResult>() },
  project_pull_request: { input: z.object({ threadId }), output: z.custom<PullRequestResult>() },
  project_environments: { input: z.object({ threadId }), output: z.custom<EnvironmentsResult>() },
};
