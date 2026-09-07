import { expect, test } from "bun:test";
import { buildWrapupBundle } from "./wrapup-bundle";
const fixture = () => buildWrapupBundle({
  now: new Date("2026-09-05T18:02:00Z"), dir: "/day", slug: "6sep-sun",
  wakePlan: "/day/ψ/memory/fleet/test_wake-plan.md", dryRun: true,
  signature: "[22-5sep-sat2026:5sep-sat2026]", digest: "digest ``` evidence",
  table: "worker table", charters: ["Done-when: tested"], warnings: [],
  commits: [{ repo: "repo-one", hash: "abc1234", at: 1788610000000, subject: "real change", author: "a" }],
  sessions: [], issues: [], prs: [], rows: [], sessionClocks: [{ session_start: "observed-start" }], sweptCount: 15,
});
test("four jobs reference one shared evidence section and retain gates/footer", () => {
  const sections = fixture().split(/^## Prompt: /m).slice(1);
  expect(sections).toHaveLength(4);
  for (const section of sections) {
    expect(section).toContain("DRY RUN. Read/inspect only");
    expect(section).toContain("evidence: see Shared evidence above");
    expect(section).toContain("Output:");
    expect(section.trim()).toEndWith("Write the file, commit only that path, push.\nNever touch a live pane.\nSign [22-5sep-sat2026:5sep-sat2026].");
  }
});
test("Bangkok path rolls forward across UTC date and has full retro requirements", () => {
  const b = fixture();
  expect(b).toContain("/retrospectives/2026-09/06/01.02_6sep-sun-wrapup.md");
  expect(b).toContain("| when | session | done | stuck | win | friction | error |");
  expect(b).toContain("Self-Audit");
  expect(b).toContain("mtime, not start");
});
test("short book has outline, committed sources, PDF and explicit issue 180", () => {
  const b = fixture();
  expect(b).toContain("2026-09-06_6sep-sun-wrapup-OUTLINE.md");
  expect(b).toContain("<=60 pages");
  expect(b).toContain("git show");
  expect(b).toContain("6sep-sun-wrapup.pdf");
  expect(b).toContain('"number": 180');
  expect(b).toContain("repo-one");
});

test("shared digest and normalized evidence appear exactly once", () => {
  const b = fixture();
  expect(b.match(/^## Shared evidence$/gm)).toHaveLength(1);
  expect(b.match(/digest ``` evidence/g)).toHaveLength(1);
  expect(b.match(/observed-start/g)).toHaveLength(1);
});
