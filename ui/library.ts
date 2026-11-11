// The component library agents are taught and the browser renders: OpenUI's
// built-in openuiLibrary without the components the user doesn't need, plus a
// Mermaid Diagram. Shared by scripts/generate.ts (prompt + schema, with a stub
// renderer) and app.tsx (the real one), so both always agree.
import { createLibrary, defineComponent, type ComponentRenderer } from "@openuidev/react-lang";
// The main entry, not "/genui-lib": that one bundles its own ThemeContext.
import { openuiComponentGroups, openuiLibrary } from "@openuidev/react-ui";
import { z } from "zod/v4";
import { EXTRA_GROUPS } from "./components";
import type { ExtraGroup } from "./components/types";

export const DROPPED = new Set(["ImageGallery", "Carousel"]);
/** The plugin's inputs that may sit in a FormControl (they register form state like the built-ins). */
const FORM_INPUTS = new Set(["Stepper", "Rating", "ListEditor", "Swatches"]);
/**
 * The only components the core prompt describes in full: what nearly every reply uses. Every
 * other component (OpenUI's and the plugin's) is named in the prompt's index and described on
 * demand by the openui_components tool, which keeps the prompt small.
 */
export const CORE = new Set([
  "Stack", "Card", "CardHeader", "TextContent", "MarkDownRenderer", "Callout", "Separator", "Table", "Col",
  "Tag", "TagBlock", "Buttons", "Button", "Tabs", "TabItem", "BarChart", "LineChart", "Series", "Diagram",
]);

export const diagramProps = z.object({
  mermaid: z.string(),
});

export const DIAGRAM_DESCRIPTION =
  'Flow diagram drawn from Mermaid source: flowcharts, pipelines, architecture, sequences, state machines. Write line breaks as \\n, e.g. Diagram("flowchart LR\\n  A[Build] --> B{Tests pass?}\\n  B -->|yes| C[Deploy]\\n  B -->|no| A"). Keep node labels to a few words and edge labels to one or two. Aim for 8 nodes or fewer: prefer LR for a chain, TD for a tree, and group related nodes with subgraph instead of one long line.';

type DiagramRenderer = ComponentRenderer<z.infer<typeof diagramProps>>;
type AnySchema = z.ZodType;

/** Unwraps optional / default / nullable so child lists inside them are found; returns the matching rewrap. */
function unwrapOptional(schema: AnySchema): [AnySchema, (inner: AnySchema) => AnySchema] {
  if (schema instanceof z.ZodOptional) {
    const [inner, rewrap] = unwrapOptional(schema.unwrap() as AnySchema);
    return [inner, (next) => rewrap(next).optional()];
  }
  if (schema instanceof z.ZodNullable) {
    const [inner, rewrap] = unwrapOptional(schema.unwrap() as AnySchema);
    return [inner, (next) => rewrap(next).nullable()];
  }
  if (schema instanceof z.ZodDefault) {
    const [inner, rewrap] = unwrapOptional(schema.unwrap() as AnySchema);
    const fallback = (schema as z.ZodDefault).def.defaultValue;
    return [inner, (next) => rewrap(next).default(fallback as never)];
  }
  return [schema, (inner) => inner];
}

export function buildLibrary(diagramView: DiagramRenderer, groups: ExtraGroup[] = EXTRA_GROUPS) {
  const Diagram = defineComponent({ name: "Diagram", props: diagramProps, description: DIAGRAM_DESCRIPTION, component: diagramView });
  const diagramRef = Diagram.ref as AnySchema;
  const base = openuiLibrary.components;
  const droppedRefs = new Set<AnySchema>([...DROPPED].map((name) => base[name]!.ref as AnySchema));
  const textRef = base.TextContent!.ref as AnySchema;
  // Every superseded component ref -> its current rebuild, so parents follow their rebuilt children.
  const refMap = new Map<AnySchema, AnySchema>();
  const current = new Map(Object.values(base).filter((c) => !DROPPED.has(c.name)).map((c) => [c.name, c]));
  const extras = groups.flatMap((group) => group.components);

  // The plugin's own form inputs join FormControl's input choices; Form follows through refMap below.
  const formInputs = extras.filter((c) => FORM_INPUTS.has(c.name)).map((c) => c.ref as AnySchema);
  const formControl = current.get("FormControl");
  const input = formControl?.props.shape.input as AnySchema | undefined;
  if (formControl && input instanceof z.ZodUnion && formInputs.length > 0) {
    const options = input.options as AnySchema[];
    const rebuilt = defineComponent({
      name: "FormControl",
      description: formControl.description,
      component: formControl.component,
      props: formControl.props.extend({ input: z.union([options[0]!, ...options.slice(1), ...formInputs]) }),
    });
    refMap.set(formControl.ref as AnySchema, rebuilt.ref as AnySchema);
    current.set("FormControl", rebuilt);
  }

  /** A child-list prop with dropped children removed, rebuilt refs followed and Diagram added to content lists; null if unchanged. */
  const rewire = (prop: AnySchema): AnySchema | null => {
    const [inner, rewrap] = unwrapOptional(prop);
    if (!(inner instanceof z.ZodArray)) return null;
    const element = inner.element as AnySchema;
    if (!(element instanceof z.ZodUnion)) {
      const next = refMap.get(element);
      return next ? rewrap(z.array(next)) : null;
    }
    const options = element.options as AnySchema[];
    const kept = options.filter((o) => !droppedRefs.has(o)).map((o) => refMap.get(o) ?? o);
    if (options.includes(textRef) && !kept.includes(diagramRef)) kept.push(diagramRef);
    const unchanged = kept.length === options.length && kept.every((o, i) => o === options[i]);
    return unchanged ? null : rewrap(z.array(z.union([kept[0]!, ...kept.slice(1)])));
  };

  // Rebuild until no component's child lists change (Card -> Tabs -> TabItem, Accordion -> AccordionItem).
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, component] of current) {
      const replaced: Record<string, AnySchema> = {};
      for (const [key, prop] of Object.entries(component.props.shape as Record<string, AnySchema>)) {
        const next = rewire(prop);
        if (next !== null) replaced[key] = next;
      }
      if (Object.keys(replaced).length === 0) continue;
      const rebuilt = defineComponent({
        name,
        description: component.description,
        component: component.component,
        props: component.props.extend(replaced),
      });
      for (const [old, now] of refMap) if (now === component.ref) refMap.set(old, rebuilt.ref as AnySchema);
      refMap.set(component.ref as AnySchema, rebuilt.ref as AnySchema);
      current.set(name, rebuilt);
      changed = true;
    }
  }
  const components = [...current.values()];

  const componentGroups = (openuiComponentGroups ?? []).map((group) => ({
    ...group,
    components: [...group.components.filter((name) => !DROPPED.has(name)), ...(group.name === "Content" ? ["Diagram"] : [])],
  }));

  return createLibrary({ root: openuiLibrary.root, components: [...components, Diagram, ...extras], componentGroups });
}
