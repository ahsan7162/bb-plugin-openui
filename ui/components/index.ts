// Every group of the plugin's own components. Add a group here (and its CSS to styles.css) to ship it.
import { filesGroup } from "./files";
import { inputsGroup } from "./inputs";
import { numbersGroup } from "./numbers";
import { planningGroup } from "./planning";
import { projectGroup } from "./project";
import { reportsGroup } from "./reports";
import { structureGroup } from "./structure";
import type { ExtraGroup } from "./types";
import { webGroup } from "./web";

export const EXTRA_GROUPS: ExtraGroup[] = [
  numbersGroup,
  inputsGroup,
  planningGroup,
  structureGroup,
  filesGroup,
  reportsGroup,
  projectGroup,
  webGroup,
];
