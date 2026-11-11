import { test } from "node:test";
import assert from "node:assert/strict";
import { chartRamp } from "./ui/theme";

test("chart ramp runs dark to light around BB's accent", () => {
  const ramp = chartRamp((css) => css);
  assert.equal(ramp.length, 11);
  assert.match(ramp[5]!, /^var\(--color-timeline-accent, var\(--primary\)\)$/);
  assert.match(ramp[0]!, /40%, black\)$/);
  assert.match(ramp[10]!, /30%, white\)$/);
});
