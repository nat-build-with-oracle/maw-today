import { expect, test } from "bun:test";
import { parseWorkers, workersTable } from "./index";

test("main body without branch is unknown, not zero", () => {
  const [r] = parseWorkers("oracle", "  01-lab [main] WORKING Context 43% left", "── 01-lab ──\n  (no branch — main-checkout worker; check the main tree's own status)");
  expect(r).toMatchObject({ worker: "01-lab", state: "WORKING", contextLeft: 43, ahead: null, cwdCheck: "unknown" });
});
test("verify counts hash lines only, including empty merged branch", () => {
  const rows = parseWorkers("o", "01-lab [wt] idle\n02-lab [wt] WORKING\n── quota ──", "── 01-lab ──\n abc1234 first\n 0123456 second\n── 02-lab ──\n");
  expect(rows.map(r => r.ahead)).toEqual([2, 0]);
  expect(rows[0].contextLeft).toBeNull();
});
test("missing verify is unknown; prose cannot fabricate workers", () => {
  expect(parseWorkers("o", "01-lab [wt] idle", "")[0].ahead).toBeNull();
  expect(parseWorkers("o", "(no session)\n agents/old — worktree with no worker window", "")).toEqual([]);
});
test("screen pipes and newlines cannot corrupt markdown rows", () => {
  const [r] = parseWorkers("o", "01-lab [main] idle", "");
  r.lastLine = "one|two\nthree";
  expect(workersTable([r])).toContain("one\\|two three");
});

import { charterBullets, prepareFleet } from "./index";
import { mkdtempSync, writeFileSync, symlinkSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("charter extraction excludes grill answers and subsequent sections", () => {
  expect(charterBullets("## Grill answers\n- **Done-when**: duplicate\n## Charter-lite\n- **Who**: worker\n- **Done-when**: correct\n- **Escalate**: approval\n## Other\n- **Done-when**: wrong\n"))
    .toEqual(["- **Done-when**: correct", "- **Escalate**: approval"]);
  expect(charterBullets("## Charter-lite\n- **Done-when**: end")).toEqual(["- **Done-when**: end"]);
  expect(charterBullets("- **Done-when**: no section")).toEqual([]);
});
test("two dry snapshots overwrite stable artifacts and preserve real history", async () => {
  const fleet = mkdtempSync(join(tmpdir(), "wrapup-test-"));
  writeFileSync(join(fleet, "INDEX.md"), "real history");
  writeFileSync(join(fleet, "real_fleet.json"), "{}");
  symlinkSync("real_fleet.json", join(fleet, "latest.json"));
  let n = 0;
  const fake = async (_cmd: string, _args: string[], opts: any) => {
    const d = opts.env.MAW_SNAPSHOT_DIR;
    const stem = `stamp-${++n}`;
    const j = join(d, `${stem}_fleet.json`), wake = join(d, `${stem}_wake-plan.md`);
    writeFileSync(j, JSON.stringify({ sessions: [], run: n }));
    writeFileSync(j.replace(".json", ".md"), `snapshot ${j}`);
    writeFileSync(wake, `wake ${wake}`);
    symlinkSync(`${stem}_fleet.json`, join(d, "latest.json"));
    writeFileSync(join(d, "INDEX.md"), "temporary history");
    return { stdout: `wake plan: ${wake}\n`, stderr: "" };
  };
  try {
    for (let i = 0; i < 2; i++) {
      const result = await prepareFleet(fleet, fleet, true, fake as any);
      expect(result.wakePlan).toBe(join(fleet, "dry-run_wake-plan.md"));
    }
    expect(readdirSync(fleet).sort()).toEqual(["INDEX.md", "dry-run_fleet.json", "dry-run_fleet.md", "dry-run_wake-plan.md", "latest.json", "real_fleet.json"]);
    expect(JSON.parse(readFileSync(join(fleet, "dry-run_fleet.json"), "utf8")).run).toBe(2);
    expect(readFileSync(join(fleet, "INDEX.md"), "utf8")).toBe("real history");
    expect(readFileSync(join(fleet, "latest.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(fleet, "dry-run_fleet.md"), "utf8")).toBe(`snapshot ${join(fleet, "dry-run_fleet.json")}`);
  } finally { rmSync(fleet, { recursive: true, force: true }); }
});
