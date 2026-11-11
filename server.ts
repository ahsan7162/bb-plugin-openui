// bb-plugin-openui backend. Teaches agents OpenUI Lang (the prompt generated
// from ui/library.ts by scripts/generate.ts) so their replies can carry
// ```openui-lang blocks, which app.tsx renders. Adds three optional tools:
// check_openui (parse a block), openui_examples and
// openui_components (docs for components the prompt only names).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { createParser } from "@openuidev/lang-core";
import { z } from "zod";
import { DOCS, EXAMPLES, PROMPT, ROOT, SCHEMA } from "./generated/openui";
import { MAX_MEDIA_BYTES, MAX_TEXT_BYTES, readThreadFile } from "./server/files";
import { createWeb, WEB_SETTING, webMethods } from "./server/web";
import { projectMethods, readChanges, readCommits, readEnvironments, readPatch, readPullRequest } from "./server/project";

const MAX_SPEC_CHARS = 60_000;

const fileResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), content: z.string(), encoding: z.enum(["utf8", "base64"]) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** Browser-callable methods; components reach them through ui/data.tsx. */
export const rpcContract = defineRpcContract({
  read_file: {
    // media: images and other binaries, allowed up to the larger limit.
    input: z.object({ threadId: z.string().min(1).max(64), path: z.string().min(1).max(1024), media: z.boolean().optional() }),
    output: fileResult,
  },
  // Map and ImageSearch lookups (server/web.ts), behind the webLookups setting.
  ...webMethods,
  // Changes, Commits, PullRequest, Environments (server/project.ts): the reply thread's live git state.
  ...projectMethods,
});

/** Parse a program the way the renderer will once its stream ends; "" when it renders cleanly. */
export function checkProgram(spec: string): string {
  // shortcut: the schema is typed `as const` JSON, which createParser accepts at runtime.
  const result = createParser(SCHEMA as never, ROOT).parse(spec);
  const problems: string[] = [];
  if (result.root === null) problems.push(`No root: define \`root = ${ROOT}(...)\`.`);
  for (const e of result.meta.errors) {
    problems.push(`${e.code} in ${e.statementId ?? e.component}${e.path}: ${e.message}`);
  }
  if (result.meta.unresolved.length > 0) problems.push(`Undefined names: ${result.meta.unresolved.join(", ")}`);
  if (result.meta.orphaned.length > 0) problems.push(`Not reachable from root (won't render): ${result.meta.orphaned.join(", ")}`);
  return problems.join("\n");
}

/** Signatures, group notes and an example for the named on-demand components. */
export function componentDocs(names: string[]): { text: string; ok: boolean } {
  const unknown = names.filter((name) => !(name in DOCS));
  const shown = new Set<string>(); // a group's notes print once per call, not once per component
  const parts = names.filter((name) => name in DOCS).map((name) => {
    const doc = DOCS[name]!;
    const fresh = doc.notes.filter((note) => !shown.has(note));
    fresh.forEach((note) => shown.add(note));
    const notes = fresh.length > 0 ? `\n${fresh.join("\n")}` : "";
    const example = doc.example ? `\nExample:\n\`\`\`openui-lang\n${doc.example}\n\`\`\`` : "";
    return `## ${name} (${doc.group})\n${doc.signature}${notes}${example}`;
  });
  if (unknown.length > 0) parts.push(`Unknown: ${unknown.join(", ")}. Available: ${Object.keys(DOCS).join(", ")}`);
  return { text: parts.join("\n\n"), ok: unknown.length === 0 };
}

export default (bb: BbPluginApi) => {
  bb.agents.registerTool({
    name: "openui_components",
    description:
      "Returns the signatures, usage notes and an example of OpenUI components that the prompt only names in its index (\"More components exist\"). Call it before using one of them.",
    parameters: z.object({
      names: z.array(z.string().min(1).max(40)).min(1).max(12).describe('Component names from the index, e.g. ["Gauge", "Timeline"]'),
    }),
    presentation: { label: { pending: "Reading OpenUI components", completed: "Read OpenUI components" }, suppress: true },
    async execute({ names }) {
      const { text, ok } = componentDocs(names);
      return { content: [{ type: "text", text }], isError: !ok };
    },
  });

  bb.agents.registerTool({
    name: "check_openui",
    description:
      "Parses a ```openui-lang block before you put it in your reply and lists errors: unknown components, wrong or missing arguments, undefined names, statements root can't reach. Optional.",
    parameters: z.object({
      spec: z.string().min(1).max(MAX_SPEC_CHARS).describe("The block's content, without the ``` fence lines"),
    }),
    presentation: { label: { pending: "Checking OpenUI", completed: "Checked OpenUI" }, suppress: true },
    async execute({ spec }) {
      const problems = checkProgram(spec);
      return { content: [{ type: "text", text: problems || "OK: the block parses and renders." }], isError: problems !== "" };
    },
  });

  bb.agents.registerTool({
    name: "openui_examples",
    description: "Returns working OpenUI Lang example programs from OpenUI's built-in library. Optional.",
    parameters: z.object({}),
    presentation: { label: { pending: "Reading OpenUI examples", completed: "Read OpenUI examples" }, suppress: true },
    async execute() {
      return { content: [{ type: "text", text: EXAMPLES.map((e) => "```openui-lang\n" + e + "\n```").join("\n\n") }] };
    },
  });

  const web = createWeb(bb.settings.define(WEB_SETTING));
  bb.rpc.register(rpcContract, {
    read_file: ({ threadId, path, media }) => readThreadFile(bb, threadId, path, media ? MAX_MEDIA_BYTES : MAX_TEXT_BYTES),
    web_geocode: (input) => web.geocode(input),
    web_tile: (input) => web.tile(input),
    web_image_search: (input) => web.imageSearch(input),
    web_wiki_photo: (input) => web.wikiPhoto(input),
    project_changes: ({ threadId, target, paths }) => readChanges(bb.sdk, threadId, target, paths),
    project_patch: ({ threadId, target, path, revision }) => readPatch(bb.sdk, threadId, target, path, revision),
    project_commits: ({ threadId, limit }) => readCommits(bb.sdk, threadId, limit ?? 20),
    project_pull_request: ({ threadId }) => readPullRequest(bb.sdk, threadId),
    project_environments: ({ threadId }) => readEnvironments(bb.sdk, threadId),
  });

  bb.agents.configure((context) => {
    // Same audience rule as genui: only sessions a person reads, not agent-spawned
    // workers or plugin-run threads (side chats excepted).
    const forPerson =
      context.pluginMetadata.audience === "person" ||
      (context.thread.parentThreadId === null &&
        (context.origin.pluginId === null || context.origin.pluginId === "side-chat"));
    if (!forPerson) return { tools: [], skills: [] };
    return { tools: ["check_openui", "openui_examples", "openui_components"], skills: [], instructions: PROMPT };
  });
};
