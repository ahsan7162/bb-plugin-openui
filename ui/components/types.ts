import type { DefinedComponent } from "@openuidev/react-lang";

/**
 * A group of the plugin's own components. They are not listed in the core
 * prompt: the prompt names them in an index, and the openui_components tool
 * returns their signatures, the group notes and examples on demand.
 */
export interface ExtraGroup {
  name: string;
  notes?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: DefinedComponent<any>[];
  /** One complete, valid program per component (with `root = Stack(...)`), keyed by component name. */
  examples: Record<string, string>;
}
