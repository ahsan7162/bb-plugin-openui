import { test } from "node:test";
import assert from "node:assert/strict";
import { gap, parseDependencies } from "./dependencies";

test("gap: major, minor, patch, 0.x minor breaks, two-part versions, missing", () => {
  assert.equal(gap("4.1.2", "6.0.1"), "major");
  assert.equal(gap("8.0.1", "8.1.8"), "minor");
  assert.equal(gap("2.32.4", "2.32.5"), "patch");
  assert.equal(gap("0.21.1", "0.28.0"), "major");
  assert.equal(gap("2.10", "3.20"), "major");
  assert.equal(gap("1.11.23", "1.11.23"), "none");
  assert.equal(gap(undefined, "1.0.0"), "missing");
});

test("npm outdated: largest gap first, up-to-date dropped, empty object is empty", () => {
  const outdated = {
    chalk: { current: "4.1.2", wanted: "4.1.2", latest: "5.6.2", type: "dependencies" },
    dayjs: { wanted: "1.11.23", latest: "1.11.23", type: "dependencies" },
    ms: { current: "2.1.2", wanted: "2.1.3", latest: "2.1.3" },
    same: { current: "1.0.0", wanted: "1.0.0", latest: "1.0.0" },
  };
  const r = parseDependencies(JSON.stringify(outdated));
  assert.deepEqual(r.outdated.map((d) => [d.name, d.gap]), [["dayjs", "missing"], ["chalk", "major"], ["ms", "patch"]]);
  assert.deepEqual(parseDependencies("{}").outdated, []);
  assert.deepEqual(parseDependencies("").outdated, []);
});

test("npm audit v2 and v1, zero vulnerabilities is empty", () => {
  const v2 = {
    auditReportVersion: 2,
    vulnerabilities: {
      "body-parser": { name: "body-parser", severity: "high", isDirect: false, via: ["qs"], range: "<1.20.3", fixAvailable: true },
      axios: {
        name: "axios",
        severity: "critical",
        isDirect: true,
        via: [{ title: "Axios SSRF", url: "https://github.com/advisories/GHSA-x", severity: "critical" }],
        range: "<=0.32.0",
        fixAvailable: { name: "axios", version: "1.8.2", isSemVerMajor: true },
      },
    },
  };
  const r = parseDependencies(JSON.stringify(v2));
  assert.deepEqual(r.vulnerabilities.map((v) => v.name), ["axios", "body-parser"]);
  assert.equal(r.vulnerabilities[0]!.fix, "axios 1.8.2 (major)");
  assert.equal(r.vulnerabilities[1]!.title, "Through qs");
  assert.deepEqual(parseDependencies(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} })).vulnerabilities, []);
  const v1 = { advisories: { "1": { module_name: "lodash", severity: "moderate", title: "Prototype pollution", vulnerable_versions: "<4.17.21", patched_versions: ">=4.17.21" } } };
  assert.equal(parseDependencies(JSON.stringify(v1)).vulnerabilities[0]!.fix, "Patched in >=4.17.21");
});

test("pip list --outdated and inline rows", () => {
  const pip = [{ name: "Flask", version: "2.0.1", latest_version: "3.1.3", latest_filetype: "wheel" }, { name: "idna", version: "2.10", latest_version: "2.11" }];
  assert.deepEqual(parseDependencies(JSON.stringify(pip)).outdated.map((d) => d.gap), ["major", "minor"]);
  assert.equal(parseDependencies([{ name: "react", current: "18.3.1", latest: "19.1.0" }]).outdated[0]!.gap, "major");
  assert.throws(() => parseDependencies("nope"), /npm outdated/);
});
