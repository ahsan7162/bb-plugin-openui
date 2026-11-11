import { test } from "node:test";
import assert from "node:assert/strict";
import { mermaidFence } from "./mermaidFence";

test("fence outgrows backtick runs in the source", () => {
  assert.equal(mermaidFence("flowchart LR\n A --> B"), "```mermaid\nflowchart LR\n A --> B\n```");
  assert.match(mermaidFence("A[\"````x\"]"), /^`````mermaid\n/);
});
