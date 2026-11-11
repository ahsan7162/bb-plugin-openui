// Read-only file access for components (Snippet, Logs, Tests, ...). A block
// names a path; this resolves it inside the reply's own thread: its workspace,
// its thread storage ("$BB_THREAD_STORAGE/...") or /tmp on the same host.
// Anything else is refused. Failures are values, never throws.
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const THREAD_STORAGE_PREFIX = "$BB_THREAD_STORAGE/";
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export type FileResult = { ok: true; content: string; encoding: "utf8" | "base64" } | { ok: false; error: string };
type Root = { path: string; hostId: string };

/** True when target is root itself or inside it (no "..", no other absolute path). */
export function contains(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** The roots a requested path may be read from, in order. Pure, so it is tested. */
export function resolveAttempts(
  requested: string,
  roots: { workspace: Root | null; storage: Root | null },
): { root: Root; target: string }[] {
  const inside = (root: Root | null, target: string) => (root !== null && contains(root.path, target) ? [{ root, target }] : []);
  if (requested.startsWith(THREAD_STORAGE_PREFIX)) {
    const root = roots.storage;
    return root === null ? [] : inside(root, path.resolve(root.path, requested.slice(THREAD_STORAGE_PREFIX.length)));
  }
  if (!path.isAbsolute(requested)) {
    const root = roots.workspace;
    return root === null ? [] : inside(root, path.resolve(root.path, requested));
  }
  const target = path.resolve(requested);
  const found = [...inside(roots.storage, target), ...inside(roots.workspace, target)];
  if (found.length > 0) return found.slice(0, 1);
  const hostId = roots.workspace?.hostId ?? roots.storage?.hostId;
  if (hostId === undefined) return [];
  // macOS keeps /tmp as a link to /private/tmp; accept either spelling.
  return ["/tmp", "/private/tmp"].flatMap((tmp) => inside({ path: tmp, hostId }, target));
}

async function threadRoots(bb: BbPluginApi, threadId: string) {
  const [thread, storage] = await Promise.all([
    bb.sdk.threads.get({ threadId, include: "environment" }),
    bb.sdk.threads.storageLocation({ threadId }).catch(() => null),
  ]);
  const environment = "environment" in thread ? thread.environment : null;
  return {
    workspace:
      typeof environment?.path === "string" && typeof environment.hostId === "string"
        ? { path: environment.path, hostId: environment.hostId }
        : null,
    storage: storage === null ? null : { path: storage.storageRootPath, hostId: storage.hostId },
  };
}

export async function readThreadFile(bb: BbPluginApi, threadId: string, requested: string, maxBytes: number): Promise<FileResult> {
  let attempts: { root: Root; target: string }[];
  try {
    attempts = resolveAttempts(requested, await threadRoots(bb, threadId));
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (attempts.length === 0) return { ok: false, error: "only files in this thread's workspace, its thread storage or /tmp can be read" };
  let first: FileResult | undefined;
  for (const { root, target } of attempts) {
    try {
      const result = await bb.sdk.files.read({ path: target, rootPath: root.path, hostId: root.hostId });
      if (!("content" in result)) {
        first ??= { ok: false, error: "the file could not be read" };
        continue;
      }
      if (result.sizeBytes > maxBytes) return { ok: false, error: `${result.sizeBytes} bytes is over the ${maxBytes}-byte limit` };
      return { ok: true, content: result.content, encoding: result.contentEncoding };
    } catch (cause) {
      const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : null;
      first ??= { ok: false, error: status === 404 ? "file not found" : cause instanceof Error ? cause.message : String(cause) };
    }
  }
  return first!;
}
