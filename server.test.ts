import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProgram, componentDocs } from "./server";
import { EXAMPLES } from "./generated/openui";

test("every stock example parses cleanly", () => {
  assert.ok(EXAMPLES.length > 0);
  for (const example of EXAMPLES) assert.equal(checkProgram(example), "", example.slice(0, 80));
});

test("reports unknown components and missing root", () => {
  assert.match(checkProgram('root = Stack([x])\nx = NotAComponent("hi")'), /unknown-component/);
  assert.match(checkProgram('title = TextContent("hi")'), /No root|orphan|reachable/i);
});

test("reports undefined names", () => {
  assert.match(checkProgram("root = Stack([missing])"), /Undefined names: missing/);
});

test("Diagram is accepted inside containers; dropped components are unknown", () => {
  const diagram = 'd = Diagram("flowchart LR\\n  A --> B")';
  assert.equal(checkProgram(`root = Stack([card])\ncard = Card([d])\n${diagram}`), "");
  assert.equal(checkProgram(`root = Stack([tabs])\ntabs = Tabs([t])\nt = TabItem("a", "A", [d])\n${diagram}`), "");
  assert.match(checkProgram('root = Stack([g])\ng = ImageGallery([])'), /unknown-component/);
  assert.match(checkProgram('root = Stack([c])\nc = Carousel([])'), /unknown-component/);
});

test("openui_components shows each note once per call", () => {
  const { text, ok } = componentDocs(["Form", "FormControl", "Input"]);
  assert.ok(ok);
  assert.equal(text.split("NEVER nest Form inside Form").length - 1, 1);
  assert.match(componentDocs(["NotReal"]).text, /Unknown: NotReal/);
});
