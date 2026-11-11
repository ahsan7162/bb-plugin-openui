// Writes generated/openui.ts from the plugin's library (ui/library.ts):
// - PROMPT: the core prompt. It describes only the CORE components in full and names every
//   other one in an index (BB caps instructions at 32,768 chars; every char is paid per thread),
// - DOCS: signature, notes and example for every other component, served by openui_components,
// - SCHEMA / ROOT: the full library, for check_openui's parser,
// - EXAMPLES: OpenUI's stock examples that still parse.
// Run after upgrading @openuidev/* or changing a component: `npm run generate`.
// The server imports only that file, so it never loads React.
import { writeFileSync, mkdirSync } from "node:fs";
import { createLibrary, createParser } from "@openuidev/react-lang";
import { openuiPromptOptions } from "@openuidev/react-ui";
import { EXTRA_GROUPS } from "../ui/components";
import { buildLibrary, CORE, DROPPED } from "../ui/library";

const LIMIT = 32_768;

// The prompt and schema only need the Diagram's name and props, not its renderer.
const full = buildLibrary(() => null);
const onDemand = new Set(Object.keys(full.components).filter((name) => !CORE.has(name)));
const builtinGroups = (full.componentGroups ?? []).map((g) => ({ ...g, components: g.components.filter((n) => onDemand.has(n)) }));

const core = createLibrary({
  root: full.root,
  components: Object.values(full.components).filter((c) => !onDemand.has(c.name)),
  componentGroups: full.componentGroups
    ?.map((g) => ({ ...g, components: g.components.filter((n) => !onDemand.has(n)), notes: [] }))
    .filter((g) => g.components.length > 0),
});

// Child items (SelectItem, StepsItem...) are left out of the index: their parent's docs name them.
const isChild = (name: string) => /Item$|^(Series|Slice|Point|ScatterSeries|Col|CompareImage|Hotspot|Flashcard|QuizQuestion|SegmentedBarPart)$/.test(name);
const index = [
  ...builtinGroups.filter((g) => g.components.some((n) => !isChild(n))).map((g) => `${g.name}: ${g.components.filter((n) => !isChild(n)).join(", ")}`),
  ...EXTRA_GROUPS.map((g) => `${g.name}: ${g.components.map((c) => c.name).filter((n) => !isChild(n)).join(", ")}`),
];

// OpenUI's stock rules: drop the ones that fight this plugin (no Query/Mutation; never invented
// data), and move rules about on-demand components into those components' docs.
const named = (rule: string) => Object.keys(full.components).filter((n) => new RegExp(`\\b${n}\\b`).test(rule));
const movedNotes = new Map<string, string[]>();
const stockRules = (openuiPromptOptions.additionalRules ?? []).filter((rule) => {
  if (/Query|Mutation|@Run|plausible/.test(rule)) return false;
  const names = named(rule);
  if (names.length > 0 && names.every((n) => onDemand.has(n))) {
    for (const n of names) movedNotes.set(n, [...(movedNotes.get(n) ?? []), rule]);
    return false;
  }
  return true;
});

const preamble = [
  "You can add live UI to your replies with OpenUI Lang, a declarative UI language this chat renders.",
  "Reply in normal markdown. Where part of a reply is better seen or used than read (numbers, comparisons, options, steps, a flow, a choice, a form), write that part as an OpenUI Lang program in a ```openui-lang fenced block, not as a markdown table, a numbered list of steps or an ASCII diagram; the rest stays prose.",
  "This holds when the user asks a question too. Skip the block only when the whole reply is a few sentences with nothing to see, or the user asks for brevity. In doubt, add the block.",
  "Each block is its own program with its own `root = Stack(...)`. Only the message that ends your turn may hold a block.",
].join(" ");

const additionalRules = [
  ...stockRules,
  "@ToAssistant(text) sends text as the user's next message.",
  "No Query() or Mutation(): write values into the program.",
  "Check a block with the check_openui tool; see examples with openui_examples.",
  ...(index.length > 0
    ? [
        `Components beyond those described above, by group. Before using any of them, call openui_components with their names for signatures, notes and examples (one call can fetch several). Put the plugin's own components (Numbers and charts onward) in a Stack; Card accepts Stack. ${index.join("; ")}.`,
      ]
    : []),
];

// No inlineMode: its stock section is written for editing one dashboard ("a question gets text
// only, NO code"; "output ONLY the changed statements"), which stops agents adding UI to answers.
const prompt = core.prompt({ preamble, additionalRules, examples: [] });
if (prompt.length > LIMIT) throw new Error(`OpenUI prompt is ${prompt.length} chars, over ${LIMIT}`);

// Signature lines come from the full library's prompt, so they match what the parser accepts.
const fullPrompt = full.prompt({ examples: [] });
const signatureOf = (name: string) => fullPrompt.split("\n").find((line) => line.startsWith(`${name}(`)) ?? null;
const docs: Record<string, { group: string; signature: string; notes: string[]; example: string | null }> = {};
for (const group of EXTRA_GROUPS) {
  for (const component of group.components) {
    const signature = signatureOf(component.name);
    if (signature === null) throw new Error(`No signature for ${component.name}`);
    docs[component.name] = { group: group.name, signature, notes: group.notes ?? [], example: group.examples[component.name] ?? null };
  }
}
for (const group of builtinGroups) {
  for (const name of group.components) {
    const signature = signatureOf(name);
    if (signature === null) continue;
    docs[name] = { group: group.name, signature, notes: [...(group.notes ?? []), ...(movedNotes.get(name) ?? [])], example: null };
  }
}

const schema = full.toJSONSchema();
const parser = createParser(schema as never, full.root!);
const parses = (program: string) => {
  const result = parser.parse(program);
  return result.root !== null && result.meta.errors.length === 0 && result.meta.unresolved.length === 0;
};
for (const [name, doc] of Object.entries(docs)) {
  if (doc.example !== null && !parses(doc.example)) throw new Error(`Example for ${name} does not parse:\n${doc.example}`);
}
// Keep only stock examples that still parse without the dropped components.
const examples = (openuiPromptOptions.examples ?? []).filter(
  (example) => ![...DROPPED].some((name) => example.includes(`${name}(`)) && parses(example),
);

mkdirSync(new URL("../generated/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../generated/openui.ts", import.meta.url),
  `// Generated by scripts/generate.ts from ui/library.ts. Do not edit.\n` +
    `export const PROMPT = ${JSON.stringify(prompt)};\n` +
    `export const ROOT = ${JSON.stringify(full.root)};\n` +
    `export const SCHEMA = ${JSON.stringify(schema)} as const;\n` +
    `export const EXAMPLES: string[] = ${JSON.stringify(examples)};\n` +
    `export const DOCS: Record<string, { group: string; signature: string; notes: string[]; example: string | null }> = ${JSON.stringify(docs)};\n`,
);
console.log(
  `prompt ${prompt.length}/${LIMIT} chars, ${Object.keys(core.components).length} core + ${onDemand.size} on-demand components, ${examples.length} stock examples`,
);
