// Checks one component group before it is registered: every component has an
// example, every example parses against the full library, renders without
// throwing (server-side, with BB's test runtime) and the signatures fit.
// Usage: npx tsx scripts/check-group.tsx ui/components/<group>.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { createParser, Renderer } from "@openuidev/react-lang";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { EXTRA_GROUPS } from "../ui/components";
import type { ExtraGroup } from "../ui/components/types";
import { FenceContext } from "../ui/data";
import { buildLibrary } from "../ui/library";

void React;
installTestPluginRuntime();
// The test runtime has no server or navigation outside renderSlot: stub them so file-backed
// components render their loading state instead of throwing.
const runtime = (globalThis as { __bbPluginRuntime?: { pluginSdkApp: Record<string, unknown> } }).__bbPluginRuntime!;
runtime.pluginSdkApp = {
  ...runtime.pluginSdkApp,
  useRpc: () => ({ call: async () => ({ ok: false, error: "no server in check" }) }),
  useBbNavigate: () => ({ openUrl: () => false, openFile: () => false, experimental_openFilePreview: () => false }),
  useSdk: () => new Proxy({}, { get: () => new Proxy(() => Promise.resolve(null), { get: (t) => t }) }),
};
const file = process.argv[2];
if (!file) throw new Error("usage: check-group.tsx <group file>");
const module = (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>;
const group = Object.values(module).find((v): v is ExtraGroup => typeof v === "object" && v !== null && "components" in v && "examples" in v);
if (!group) throw new Error(`${file} exports no ExtraGroup`);

const others = EXTRA_GROUPS.filter((g) => g.name !== group.name);
const library = buildLibrary(() => null, [...others, group]);
const parser = createParser(library.toJSONSchema() as never, library.root!);
const taken = new Set(Object.keys(buildLibrary(() => null, others).components));
let failures = 0;
const fail = (message: string) => {
  failures++;
  console.log(`FAIL ${message}`);
};
for (const component of group.components) {
  if (taken.has(component.name)) fail(`${component.name}: name already used by another component`);
  const example = group.examples[component.name];
  if (!example) {
    fail(`${component.name}: no example`);
    continue;
  }
  const result = parser.parse(example);
  const problems = [
    ...(result.root === null ? ["no root"] : []),
    ...result.meta.errors.map((e) => `${e.code} in ${e.statementId ?? e.component}${e.path}: ${e.message}`),
    ...result.meta.unresolved.map((n) => `undefined name ${n}`),
    ...result.meta.orphaned.map((n) => `unreachable ${n}`),
  ];
  if (!example.includes(`${component.name}(`)) problems.push(`example does not use ${component.name}`);
  if (problems.length > 0) {
    fail(`${component.name}: ${problems.join("; ")}`);
    continue;
  }
  for (const isStreaming of [true, false]) {
    try {
      const html = renderToStaticMarkup(
        <FenceContext.Provider value={{ threadId: "thr_test", messageId: "msg_test" }}>
          <Renderer response={example} library={library} isStreaming={isStreaming} />
        </FenceContext.Provider>,
      );
      if (!isStreaming && html.length < 80) fail(`${component.name}: rendered almost nothing (${html.length} chars)`);
    } catch (cause) {
      fail(`${component.name}: render threw${isStreaming ? " while streaming" : ""}: ${cause instanceof Error ? cause.message : cause}`);
    }
  }
}
const prompt = library.prompt({ examples: [] });
const signatures = group.components.map((c) => prompt.split("\n").find((l) => l.startsWith(`${c.name}(`)) ?? "");
const longest = Math.max(...signatures.map((s) => s.length));
console.log(`${group.name}: ${group.components.length} components, signatures ${signatures.join("").length} chars (longest ${longest})`);
if (longest > 600) fail("a signature is over 600 chars; shorten its description or props");
console.log(failures === 0 ? "OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
