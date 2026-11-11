// "BB project": live views of the reply's own thread, read from BB when the
// block is shown (never data the agent writes in): its changes, commits, pull
// request, subthreads and the project's environments. Git reads go through
// server/project.ts; thread status comes from BB's live sidebar view.
import { useContext, useEffect, useState, type ReactNode } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import {
  experimental_Diff as Diff,
  experimental_ThreadStatusGlyph as StatusGlyph,
  experimental_ThreadTitleText as ThreadTitleText,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRpc,
  UrlLink,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { ChevronRight, FolderGit2, GitCommitHorizontal, GitPullRequest, ListTree, GitBranch } from "lucide-react";
import type { rpcContract } from "../../server";
import type { ChangeRow, ChangesResult, CommitsResult, EnvironmentsResult, GitTarget, PatchResult, PullRequestResult, PullRequestView } from "../../server/project";
import { FenceContext, type Loaded } from "../data";
import { EmptyState, ErrorState, fmt, Skeleton, useStreaming } from "./kit";
import type { ExtraGroup } from "./types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Ok<T> = Extract<T, { ok: true }>;
const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Reads once the block stops streaming (props are final), again when `key` changes. */
function useLive<T extends { ok: boolean }>(key: string, read: (rpc: Rpc, threadId: string) => Promise<T | { ok: false; error: string }>): Loaded<Ok<T>> {
  const fence = useContext(FenceContext);
  const rpc = useRpc<typeof rpcContract>();
  const streaming = useStreaming();
  const [loaded, setLoaded] = useState<Loaded<Ok<T>>>({ state: "loading" });
  useEffect(() => {
    if (fence === null || streaming) return;
    let live = true;
    setLoaded({ state: "loading" });
    read(rpc, fence.threadId).then(
      (result) => live && setLoaded("error" in result ? { state: "error", error: result.error } : { state: "ready", value: result as Ok<T> }),
      (cause: unknown) => live && setLoaded({ state: "error", error: messageOf(cause) }),
    );
    return () => {
      live = false;
    };
    // `read` is rebuilt every render; `key` carries its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fence, rpc, streaming]);
  return loaded;
}

/** server/project.ts NOT_GIT: the thread runs in a plain folder, a state rather than an error. */
const NOT_GIT = "Not a git checkout";

/** Loading and error of a region; empty is the caller's (it knows what is empty). */
function Region<T>({ loaded, failed, lines = 3, children }: { loaded: Loaded<T>; failed: string; lines?: number; children: (value: T) => ReactNode }) {
  if (loaded.state === "loading") return <Skeleton lines={lines} />;
  if (loaded.state === "error" && loaded.error === NOT_GIT) {
    return <EmptyState title="Not a git checkout" hint="This reads a git checkout or worktree; this thread runs in a plain folder." />;
  }
  if (loaded.state === "error") return <ErrorState title={failed} detail={`${loaded.error.replace(/\.$/, "")}. Ask again once it is fixed.`} />;
  return <>{children(loaded.value)}</>;
}

function Block({ icon, title, meta, label, children }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; label: string; children: ReactNode }) {
  return (
    <section className="bbui bbui-project" aria-label={label}>
      <header className="bbui-project-head">
        {icon}
        <span className="bbui-head">{title}</span>
        {meta ? <span className="bbui-label">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n, { decimals: 0 })} ${n === 1 ? one : many}`;

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="bbui-project-counts">
      <span className="bbui-project-add">+{fmt(additions, { decimals: 0 })}</span>
      <span className="bbui-project-del">-{fmt(deletions, { decimals: 0 })}</span>
    </span>
  );
}

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="bbui-project-row" aria-expanded={open} onClick={onToggle}>
      <ChevronRight {...ICON} className="bbui-project-chevron" />
      {children}
    </button>
  );
}

// Changes

const KIND_WORDS: Record<string, string> = { added: "added", deleted: "deleted", renamed: "renamed", copied: "copied", type_changed: "type changed" };

function FileDiff({ file, target }: { file: ChangeRow; target: GitTarget }) {
  const needsLoad = file.patch === null && !file.binary && !file.tooLarge;
  const loaded = useLive<PatchResult>(needsLoad ? `${file.path}|${file.revision}` : "", (rpc, threadId) =>
    needsLoad ? rpc.call("project_patch", { threadId, target, path: file.path, revision: file.revision }) : Promise.resolve({ ok: true, patch: file.patch ?? "", truncated: file.patchTruncated }),
  );
  if (file.binary) return <p className="bbui-label bbui-project-note">Binary file, no text diff.</p>;
  if (file.tooLarge) return <p className="bbui-label bbui-project-note">Too large to show here. Open BB’s Diff tab to read it.</p>;
  return (
    <Region loaded={loaded} failed="This diff could not be read" lines={4}>
      {({ patch, truncated }) => (
        <div className="bbui-project-diff">
          <Diff patch={patch} path={file.path} />
          {truncated ? <p className="bbui-label bbui-project-note">The diff is cut short here.</p> : null}
        </div>
      )}
    </Region>
  );
}

function FileItem({ file, target }: { file: ChangeRow; target: GitTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="bbui-project-item">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        <span className="bbui-project-grow bbui-mono bbui-project-path">
          {file.previousPath !== null ? `${file.previousPath} to ${file.path}` : file.path}
        </span>
        {file.untracked ? <span className="bbui-label">new, untracked</span> : KIND_WORDS[file.kind] ? <span className="bbui-label">{KIND_WORDS[file.kind]}</span> : null}
        {file.binary ? <span className="bbui-label">binary</span> : <Counts additions={file.additions} deletions={file.deletions} />}
      </Disclosure>
      {open ? <FileDiff file={file} target={target} /> : null}
    </li>
  );
}

function scopeTitle(scope: Ok<ChangesResult>["scope"]): { title: string; meta: string } {
  switch (scope.kind) {
    case "branch":
      return { title: `Changes on ${scope.branch}`, meta: `since ${scope.base}, uncommitted included` };
    case "uncommitted":
      return { title: "Uncommitted changes", meta: scope.branch ? `on ${scope.branch}` : "" };
    case "commit":
      return { title: `Commit ${scope.sha.slice(0, 7)}`, meta: scope.subject ?? "" };
  }
}

/** The file list for a target; `titled` false when it sits inside a Commits row. */
function ChangesBody({ target, paths, onTitle }: { target?: string; paths?: string[]; onTitle?: (title: { title: string; meta: string }) => void }) {
  const loaded = useLive<ChangesResult>(`${target ?? ""}|${(paths ?? []).join("\n")}`, (rpc, threadId) =>
    rpc.call("project_changes", { threadId, ...(target ? { target } : {}), ...(paths && paths.length > 0 ? { paths } : {}) }),
  );
  const scope = loaded.state === "ready" ? loaded.value.scope : null;
  useEffect(() => {
    if (scope !== null) onTitle?.(scopeTitle(scope));
  }, [scope, onTitle]);
  return (
    <Region loaded={loaded} failed="This thread's changes could not be read">
      {(changes) => {
        if (changes.files.length === 0) {
          const hint =
            paths && paths.length > 0
              ? `No changed file matches ${paths.join(", ")}.`
              : changes.scope.kind === "branch"
                ? `Nothing changed on ${changes.scope.branch} since ${changes.scope.base}.`
                : changes.scope.kind === "commit"
                  ? "This commit changes no files."
                  : "The working tree is clean. Ask for the branch's changes or a commit instead.";
          return <EmptyState title="No changes" hint={hint} />;
        }
        const additions = changes.files.reduce((sum, f) => sum + f.additions, 0);
        const deletions = changes.files.reduce((sum, f) => sum + f.deletions, 0);
        return (
          <>
            <p className="bbui-project-summary">
              <span>{plural(changes.total, "file")}</span>
              <Counts additions={additions} deletions={deletions} />
              {changes.truncated ? <span className="bbui-label">first {fmt(changes.files.length, { decimals: 0 })} shown</span> : null}
            </p>
            <ol className="bbui-project-list">
              {changes.files.map((file) => (
                <FileItem key={file.path} file={file} target={changes.target} />
              ))}
            </ol>
          </>
        );
      }}
    </Region>
  );
}

const textList = z.array(z.string());

const Changes = defineComponent({
  name: "Changes",
  description:
    'Files changed in this thread\'s environment with +/- counts, each opening its diff. target: omit for the branch\'s work (uncommitted included), "uncommitted", or a commit sha. paths: files, folders or globs.',
  props: z.object({ target: z.string().optional(), paths: textList.optional() }),
  component: ({ props }) => {
    const [title, setTitle] = useState<{ title: string; meta: string }>({ title: "Changes", meta: "" });
    const paths = Array.isArray(props.paths) ? props.paths.filter((p): p is string => typeof p === "string" && p !== "") : undefined;
    const target = typeof props.target === "string" && props.target.trim() !== "" ? props.target.trim() : undefined;
    return (
      <Block icon={<GitBranch {...ICON} />} title={title.title} meta={title.meta} label="Changes">
        <ChangesBody target={target} paths={paths} onTitle={setTitle} />
      </Block>
    );
  },
});

// Commits

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(at: number): string {
  const ms = at < 1e12 ? at * 1000 : at; // git gives seconds, BB usually milliseconds
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  if (Math.abs(minutes) < 60 * 48) return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / 1440), "day");
}

function CommitItem({ commit }: { commit: Ok<CommitsResult>["commits"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="bbui-project-item">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        <span className="bbui-project-grow">{commit.subject}</span>
        <span className="bbui-label">
          {commit.author}, {ago(commit.authoredAt)}
        </span>
        <span className="bbui-mono bbui-project-sha">{commit.shortSha}</span>
      </Disclosure>
      {open ? (
        <div className="bbui-project-nested">
          <ChangesBody target={commit.sha} />
        </div>
      ) : null}
    </li>
  );
}

const Commits = defineComponent({
  name: "Commits",
  description: "This branch's commits since its base branch, newest first; each opens the files it changed. limit: most shown (default 20).",
  props: z.object({ limit: z.number().optional() }),
  component: ({ props }) => {
    const limit = typeof props.limit === "number" && Number.isFinite(props.limit) ? Math.min(100, Math.max(1, Math.round(props.limit))) : 20;
    const loaded = useLive<CommitsResult>(String(limit), (rpc, threadId) => rpc.call("project_commits", { threadId, limit }));
    const view = loaded.state === "ready" ? loaded.value : null;
    const title = view ? `${plural(view.total, "commit")} on ${view.branch ?? "a detached HEAD"}` : "Commits";
    const meta = view?.base ? `since ${view.base}${view.behind > 0 ? `, ${view.behind} behind` : ""}` : "";
    return (
      <Block icon={<GitCommitHorizontal {...ICON} />} title={title} meta={meta} label="Commits">
        <Region loaded={loaded} failed="This branch's commits could not be read">
          {(commits) =>
            commits.commits.length === 0 ? (
              <EmptyState
                title="No commits yet"
                hint={commits.base ? `Nothing is committed on this branch since ${commits.base}. Uncommitted work shows in Changes.` : "This checkout has no base branch to compare with."}
              />
            ) : (
              <>
                <ol className="bbui-project-list">
                  {commits.commits.map((commit) => (
                    <CommitItem key={commit.sha} commit={commit} />
                  ))}
                </ol>
                {commits.total > commits.commits.length ? (
                  <p className="bbui-label bbui-project-note">Newest {fmt(commits.commits.length, { decimals: 0 })} of {fmt(commits.total, { decimals: 0 })} shown.</p>
                ) : null}
              </>
            )
          }
        </Region>
      </Block>
    );
  },
});

// PullRequest

type ToneName = "good" | "warn" | "bad" | "neutral" | "accent";
const STATE_WORDS: Record<string, [string, ToneName]> = { open: ["Open", "accent"], draft: ["Draft", "neutral"], merged: ["Merged", "good"], closed: ["Closed", "neutral"] };
const ATTENTION_WORDS: Record<string, [string, ToneName]> = {
  checks_failed: ["Checks are failing", "bad"],
  checks_pending: ["Checks are running", "warn"],
  changes_requested: ["Changes were requested", "bad"],
  review_requested: ["Waiting for review", "warn"],
  conflicts: ["Has merge conflicts", "bad"],
  blocked: ["Merging is blocked", "warn"],
  draft: ["Still a draft", "neutral"],
  queued: ["In the merge queue", "accent"],
  ready_to_merge: ["Ready to merge", "good"],
  merged: ["Merged", "good"],
  closed: ["Closed without merging", "neutral"],
};
const REVIEW_WORDS: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  review_requested: "Review requested",
  none: "No reviews yet",
};
const MERGE_WORDS: Record<string, string> = { mergeable: "Can merge", conflicts: "Conflicts with the base", blocked: "Blocked by rules", draft: "Draft", unknown: "Not known yet" };

function checksWords(checks: PullRequestView["checks"]): string {
  if (checks.total === 0) return "No checks";
  const parts = [checks.passed > 0 && `${checks.passed} passed`, checks.failed > 0 && `${checks.failed} failed`, checks.pending > 0 && `${checks.pending} running`];
  return parts.filter(Boolean).join(", ") || `${checks.total} with no result`;
}

function PullRequestBody({ pr }: { pr: PullRequestView }) {
  const [state, stateTone] = STATE_WORDS[pr.state] ?? [pr.state, "neutral"];
  const attention = ATTENTION_WORDS[pr.attention];
  const checksTone: ToneName = pr.checks.failed > 0 ? "bad" : pr.checks.pending > 0 ? "warn" : pr.checks.total > 0 ? "good" : "neutral";
  return (
    <>
      <p className="bbui-project-pr-title">
        <UrlLink href={pr.url} className="bbui-project-link">
          {pr.title}
        </UrlLink>
        <span className="bbui-label">#{pr.number}</span>
        <span className="bbui-project-tone" data-tone={stateTone}>
          {state}
        </span>
      </p>
      {attention && attention[0] !== state ? (
        <p className="bbui-project-tone bbui-project-attention" data-tone={attention[1]}>
          {attention[0]}
        </p>
      ) : null}
      <dl className="bbui-project-facts">
        <dt className="bbui-label">Checks</dt>
        <dd className="bbui-project-tone" data-tone={checksTone}>
          {checksWords(pr.checks)}
        </dd>
        <dt className="bbui-label">Review</dt>
        <dd>
          {REVIEW_WORDS[pr.review.state] ?? pr.review.state}
          {pr.review.requests > 0 && pr.review.state !== "approved" ? `, ${plural(pr.review.requests, "reviewer")} asked` : ""}
        </dd>
        {pr.state === "open" || pr.state === "draft" ? (
          <>
            <dt className="bbui-label">Merge</dt>
            <dd>{MERGE_WORDS[pr.mergeability] ?? pr.mergeability}</dd>
          </>
        ) : null}
        <dt className="bbui-label">Branch</dt>
        <dd className="bbui-mono bbui-project-path">
          {pr.head} into {pr.base}
        </dd>
      </dl>
    </>
  );
}

const PullRequest = defineComponent({
  name: "PullRequest",
  description: "This thread's branch's GitHub pull request, live: title and link, state, checks, review and merge state. No arguments.",
  props: z.object({}),
  component: () => {
    const loaded = useLive<PullRequestResult>("pr", (rpc, threadId) => rpc.call("project_pull_request", { threadId }));
    return (
      <Block icon={<GitPullRequest {...ICON} />} title="Pull request" label="Pull request">
        <Region loaded={loaded} failed="The pull request could not be read" lines={4}>
          {({ branch, pullRequest }) =>
            pullRequest === null ? (
              <EmptyState
                title={`No pull request for ${branch ?? "this branch"}`}
                hint="Push the branch and open a pull request on GitHub; it shows here once GitHub has it."
              />
            ) : (
              <PullRequestBody pr={pullRequest} />
            )
          }
        </Region>
      </Block>
    );
  },
});

// Threads

/**
 * BB's live sidebar view of threads. shortcut: BB's test runtime only provides it inside renderSlot,
 * which scripts/check-group.tsx doesn't use; there it throws (after one useContext, so hook order holds)
 * and reads as an error. Drop the try once check-group mounts through renderSlot.
 */
function useLiveThreads(): { status: "error" | "loading" | "ready"; threads: readonly PluginSidebarThread[] } {
  try {
    return useSidebarThreads();
  } catch {
    return { status: "error", threads: [] };
  }
}

type ThreadState = Pick<PluginSidebarThread, "runtimeStatus" | "hasPendingInteraction" | "isArchived">;
export function statusWords(thread: ThreadState): string {
  if (thread.isArchived) return "Archived";
  if (thread.hasPendingInteraction) return "Needs input";
  switch (thread.runtimeStatus) {
    case "active":
    case "starting":
      return "Working";
    case "stopping":
      return "Stopping";
    case "pending":
      return "Queued";
    case "provisioning":
      return "Setting up";
    case "waiting-for-host":
      return "Waiting for its machine";
    case "error":
      return "Failed";
    default:
      return "Idle";
  }
}

function ThreadItem({ thread }: { thread: PluginSidebarThread }) {
  const navigate = useBbNavigate();
  return (
    <li className="bbui-project-item">
      <button type="button" className="bbui-project-row" onClick={() => navigate.toThread(thread.id)} aria-label={`Open ${thread.displayTitle}, ${statusWords(thread)}`}>
        <span className="bbui-project-glyph">
          <StatusGlyph indicator={thread.indicator} archived={thread.isArchived} size="compact" />
        </span>
        <span className="bbui-project-grow">
          <ThreadTitleText title={thread.title ?? thread.displayTitle} />
        </span>
        <span className="bbui-label">{statusWords(thread)}</span>
      </button>
    </li>
  );
}

const Threads = defineComponent({
  name: "Threads",
  description: "Live status of BB threads: title, status, opens the thread. ids: thread ids in this project; omit for this thread's subthreads.",
  props: z.object({ ids: textList.optional() }),
  component: ({ props }) => {
    const fence = useContext(FenceContext);
    const sidebar = useLiveThreads();
    const ids = Array.isArray(props.ids) ? props.ids.filter((id): id is string => typeof id === "string" && id !== "").slice(0, 50) : null;
    const all = sidebar.threads ?? [];
    const own = all.find((t) => t.id === fence?.threadId);
    const rows: (PluginSidebarThread | string)[] =
      ids === null
        ? all.filter((t) => t.parentThreadId === fence?.threadId && !t.isHidden)
        : // Another project's thread is as absent here as an unknown one.
          ids.map((id) => all.find((t) => t.id === id && t.projectId === own?.projectId) ?? id);
    const found = rows.filter((r): r is PluginSidebarThread => typeof r !== "string");
    const working = found.filter((t) => statusWords(t) === "Working").length;
    const waiting = found.filter((t) => t.hasPendingInteraction).length;
    const meta = [working > 0 && `${working} working`, waiting > 0 && `${waiting} need input`].filter(Boolean).join(", ");
    const title = ids === null ? "Subthreads" : "Threads";
    const loaded: Loaded<null> = sidebar.status === "ready" ? { state: "ready", value: null } : sidebar.status === "error" ? { state: "error", error: "BB's thread list did not load" } : { state: "loading" };
    return (
      <Block icon={<ListTree {...ICON} />} title={title} meta={meta} label={title}>
        <Region loaded={loaded} failed="Thread status could not be read">
          {() =>
            rows.length === 0 ? (
              <EmptyState
                title={ids === null ? "No subthreads yet" : "No threads named"}
                hint={ids === null ? "Threads this one starts show here with their live status." : "Pass thread ids from this project."}
              />
            ) : (
              <ol className="bbui-project-list">
                {rows.map((row) =>
                  typeof row === "string" ? (
                    <li key={row} className="bbui-project-item bbui-project-missing bbui-label">
                      <span className="bbui-mono">{row}</span> is not an active thread in this project.
                    </li>
                  ) : (
                    <ThreadItem key={row.id} thread={row} />
                  ),
                )}
              </ol>
            )
          }
        </Region>
      </Block>
    );
  },
});

// Environments

const THREADS_PER_ENVIRONMENT = 3;

function EnvironmentItem({ env, threads }: { env: Ok<EnvironmentsResult>["environments"][number]; threads: PluginSidebarThread[] }) {
  const pr = env.pullRequest;
  return (
    <li className="bbui-project-env" aria-current={env.current ? "true" : undefined}>
      <p className="bbui-project-env-head">
        <span className="bbui-mono bbui-project-path bbui-project-grow">{env.branch ?? env.name ?? env.id}</span>
        <span className="bbui-label">{env.current ? `${env.kind}, this thread's environment` : env.kind}</span>
      </p>
      <p className="bbui-project-env-facts bbui-label">
        {env.note !== null ? (
          <span>{env.note}</span>
        ) : (
          <>
            {env.changes && env.changes.files > 0 ? (
              <span>
                {plural(env.changes.files, "uncommitted file")} <Counts additions={env.changes.additions} deletions={env.changes.deletions} />
              </span>
            ) : (
              <span>No uncommitted changes</span>
            )}
            {env.ahead !== null && env.ahead > 0 ? <span>{plural(env.ahead, "commit")} ahead</span> : null}
            {env.behind !== null && env.behind > 0 ? <span>{fmt(env.behind, { decimals: 0 })} behind</span> : null}
          </>
        )}
        {pr ? (
          <UrlLink href={pr.url} className="bbui-project-link" title={pr.title}>
            #{pr.number} {STATE_WORDS[pr.state]?.[0].toLowerCase() ?? pr.state}
          </UrlLink>
        ) : null}
      </p>
      {threads.length > 0 ? (
        <ol className="bbui-project-list bbui-project-env-threads">
          {threads.slice(0, THREADS_PER_ENVIRONMENT).map((thread) => (
            <ThreadItem key={thread.id} thread={thread} />
          ))}
          {threads.length > THREADS_PER_ENVIRONMENT ? (
            <li className="bbui-label bbui-project-note">and {plural(threads.length - THREADS_PER_ENVIRONMENT, "more thread")}</li>
          ) : null}
        </ol>
      ) : null}
    </li>
  );
}

const Environments = defineComponent({
  name: "Environments",
  description: "This project's environments (checkouts and worktrees): branch, its live threads, uncommitted and ahead counts, pull request. No arguments.",
  props: z.object({}),
  component: () => {
    const loaded = useLive<EnvironmentsResult>("environments", (rpc, threadId) => rpc.call("project_environments", { threadId }));
    const sidebar = useLiveThreads();
    const byEnvironment = new Map<string, PluginSidebarThread[]>();
    for (const thread of sidebar.threads ?? []) {
      const id = thread.environment?.id;
      if (!id || thread.isHidden) continue;
      byEnvironment.set(id, [...(byEnvironment.get(id) ?? []), thread]);
    }
    const view = loaded.state === "ready" ? loaded.value : null;
    return (
      <Block icon={<FolderGit2 {...ICON} />} title="Environments" meta={view ? plural(view.total, "environment") : ""} label="Environments">
        <Region loaded={loaded} failed="This project's environments could not be read" lines={4}>
          {({ environments, total }) =>
            environments.length === 0 ? (
              <EmptyState title="No environments" hint="Start a thread in this project and its checkout or worktree shows here." />
            ) : (
              <>
                <ol className="bbui-project-envs">
                  {environments.map((env) => (
                    <EnvironmentItem key={env.id} env={env} threads={byEnvironment.get(env.id) ?? []} />
                  ))}
                </ol>
                {total > environments.length ? (
                  <p className="bbui-label bbui-project-note">The {fmt(environments.length, { decimals: 0 })} most recent of {fmt(total, { decimals: 0 })} shown.</p>
                ) : null}
              </>
            )
          }
        </Region>
      </Block>
    );
  },
});

export const projectGroup: ExtraGroup = {
  name: "BB project",
  notes: [
    "These read this thread's live state from BB when shown: pass no data, only the arguments listed. Prefer them to listing files, commits or statuses by hand.",
  ],
  components: [Changes, Commits, PullRequest, Threads, Environments],
  examples: {
    Changes: 'root = Stack([intro, changes])\nintro = TextContent("Here is everything this branch changes in the parser so far.")\nchanges = Changes(null, ["src/parser", "*.md"])',
    Commits: 'root = Stack([intro, commits])\nintro = TextContent("The last ten commits on this branch:")\ncommits = Commits(10)',
    PullRequest: 'root = Stack([intro, pr])\nintro = TextContent("The pull request is up; its checks are below.")\npr = PullRequest()',
    Threads: 'root = Stack([intro, threads])\nintro = TextContent("I split the work across three subthreads:")\nthreads = Threads()',
    Environments: 'root = Stack([intro, envs])\nintro = TextContent("Every worktree in this project and what is on it:")\nenvs = Environments()',
  },
};
