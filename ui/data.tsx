// What components know about the reply they sit in, and the one way they read
// files: through the server's read_file RPC, scoped to that reply's thread.
import { createContext, useContext, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export const FenceContext = createContext<{ threadId: string; messageId: string } | null>(null);

export type Loaded<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; value: T };

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
};

/** Reads a text file, or with `media` an image as a data URL. Null path = idle in loading state. */
export function useThreadFile(path: string | null | undefined, { media = false } = {}): Loaded<string> {
  const fence = useContext(FenceContext);
  const rpc = useRpc<typeof rpcContract>();
  const [loaded, setLoaded] = useState<Loaded<string>>({ state: "loading" });
  useEffect(() => {
    if (!path || fence === null) return;
    let live = true;
    setLoaded({ state: "loading" });
    const type = MEDIA_TYPES[/\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""];
    if (media && type === undefined) {
      setLoaded({ state: "error", error: `only ${Object.keys(MEDIA_TYPES).join(", ")} images can be shown` });
      return;
    }
    rpc
      .call("read_file", { threadId: fence.threadId, path, media })
      .then((file) => {
        if (!live) return;
        if (!file.ok) return setLoaded({ state: "error", error: file.error });
        if (!media) return setLoaded({ state: "ready", value: file.encoding === "utf8" ? file.content.replace(/^﻿/, "") : atob(file.content) });
        const base64 = file.encoding === "base64" ? file.content : btoa(unescape(encodeURIComponent(file.content)));
        setLoaded({ state: "ready", value: `data:${type};base64,${base64}` });
      })
      .catch((cause: unknown) => live && setLoaded({ state: "error", error: cause instanceof Error ? cause.message : String(cause) }));
    return () => {
      live = false;
    };
  }, [path, media, fence, rpc]);
  return loaded;
}
