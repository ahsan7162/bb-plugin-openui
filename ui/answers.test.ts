import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser } from "@openuidev/lang-core";
import { ROOT, SCHEMA } from "../generated/openui";
import { answerLines, collectForms } from "./answers";

const program = `root = Stack([form])
form = Form("thesis", btns, [f1, f2, f3])
f1 = FormControl("Does this fit?", g1)
g1 = RadioGroup("verdict", [a, b], "approve")
a = RadioItem("Approve and build", "d", "approve")
b = RadioItem("Adjust first", "d", "adjust")
f2 = FormControl("Phases", g2)
g2 = CheckBoxGroup("phases", [c1, c2])
c1 = CheckBoxItem("One", "d", "p1", true)
c2 = CheckBoxItem("Two", "d", "p2")
f3 = FormControl("Anything else?", t)
t = TextArea("notes", "Optional")
btns = Buttons([go])
go = Button("Send", @ToAssistant("x"), "primary")`;

const forms = collectForms(createParser(SCHEMA as never, ROOT).parse(program).root);

test("untouched fields send their defaults, as labels", () => {
  assert.deepEqual(answerLines(forms, undefined, "thesis"), ["Does this fit? Approve and build", "Phases: One", "Anything else? No answer"]);
});

test("touched fields send what was picked", () => {
  const state = { thesis: { verdict: { value: "adjust" }, phases: { value: { p1: false, p2: true } }, notes: { value: "Darker charts" } } };
  assert.deepEqual(answerLines(forms, state, "thesis"), ["Does this fit? Adjust first", "Phases: Two", "Anything else? Darker charts"]);
});
