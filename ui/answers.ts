// Turns a submitted form into the chat message a person would write: one
// "question answer" line per field, in the form's order, with option labels
// instead of values and each field's default when it was never touched.
import type { ElementNode } from "@openuidev/react-lang";

type Field = {
  name: string;
  question: string;
  kind: "multi" | "single" | "plain";
  /** value (or item name for multi) -> label */
  options: Map<string, string>;
  fallback: unknown;
};

const isElement = (value: unknown): value is ElementNode =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";

function children(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  if (!isElement(node)) return [];
  return Object.values(node.props).flatMap((prop) => (Array.isArray(prop) ? prop : [prop]));
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

function fieldOf(question: string, input: ElementNode): Field | null {
  const props = input.props;
  const name = text(props.name);
  if (!name) return null;
  // Swatches lists its options as `colors`: CSS strings or {value, name}.
  if (Array.isArray(props.colors)) {
    const options = new Map(
      props.colors.map((c) => (typeof c === "string" ? [c, c] : [String((c as { value: unknown }).value), text((c as { name?: unknown }).name) ?? String((c as { value: unknown }).value)])) as [string, string][],
    );
    return { name, question, kind: "single", options, fallback: props.value };
  }
  const items = (Array.isArray(props.items) ? props.items : []).filter(isElement);
  // Checkbox-like groups: each item is its own named boolean.
  if (items.length > 0 && items.every((item) => typeof item.props.name === "string" && item.props.value === undefined)) {
    const options = new Map(items.map((item) => [item.props.name as string, text(item.props.label) ?? (item.props.name as string)]));
    const fallback = Object.fromEntries(items.map((item) => [item.props.name as string, item.props.defaultChecked === true]));
    return { name, question, kind: "multi", options, fallback };
  }
  if (items.length > 0) {
    const options = new Map(
      items.map((item) => [String(item.props.value), text(item.props.label) ?? text(item.props.title) ?? String(item.props.value)]),
    );
    return { name, question, kind: "single", options, fallback: props.defaultValue ?? props.value };
  }
  return { name, question, kind: "plain", options: new Map(), fallback: props.defaultValue ?? props.value };
}

/** Every form in the program: form name -> its fields in order. */
export function collectForms(root: ElementNode | null): Map<string, Field[]> {
  const forms = new Map<string, Field[]>();
  const walk = (node: unknown, form: string | null) => {
    if (isElement(node) && node.typeName === "Form" && typeof node.props.name === "string") {
      form = node.props.name;
      if (!forms.has(form)) forms.set(form, []);
    }
    if (form !== null && isElement(node) && node.typeName === "FormControl" && isElement(node.props.input)) {
      const field = fieldOf(text(node.props.label) ?? "", node.props.input);
      if (field) forms.get(form)!.push(field);
      return;
    }
    for (const child of children(node)) walk(child, form);
  };
  walk(root, null);
  return forms;
}

function answerOf(field: Field, raw: unknown): string {
  const value = raw ?? field.fallback;
  if (field.kind === "multi") {
    const checked = typeof value === "object" && value !== null ? value : {};
    const picked = [...field.options].filter(([name]) => (checked as Record<string, unknown>)[name] === true).map(([, label]) => label);
    return picked.length > 0 ? picked.join(", ") : "None";
  }
  if (value === undefined || value === null || value === "") return "No answer";
  if (Array.isArray(value)) return value.map((v) => field.options.get(String(v)) ?? String(v)).join(", ");
  return field.options.get(String(value)) ?? String(value);
}

/** "Question? Answer" lines for one form (or every form when formName is absent). */
export function answerLines(
  forms: Map<string, Field[]>,
  formState: Record<string, unknown> | undefined,
  formName?: string,
): string[] {
  const names = formName !== undefined ? [formName] : [...forms.keys()];
  return names.flatMap((form) => {
    const state = (formState?.[form] ?? {}) as Record<string, { value?: unknown } | undefined>;
    return (forms.get(form) ?? []).map((field) => {
      const answer = answerOf(field, state[field.name]?.value);
      const question = field.question.trim() || field.name;
      return /[?:]$/.test(question) ? `${question} ${answer}` : `${question}: ${answer}`;
    });
  });
}
