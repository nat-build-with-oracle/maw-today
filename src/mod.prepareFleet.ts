import { mkdirSync, writeFileSync, realpathSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { run } from "./types";

export async function prepareFleet(dir: string, fleetDir: string, dryRun: boolean, execute = run) {
  mkdirSync(fleetDir, { recursive: true });
  // The upstream writer always stamps and updates latest/INDEX. Isolate dry runs,
  // publish only four stable filenames, and leave real-run history untouched.
  const destination = dryRun ? mkdtempSync(join(fleetDir, ".dry-run-")) : fleetDir;
  try {
    const prep = await execute("python3", [join(homedir(), ".claude/skills/maw-teams/scripts/maw_teams.py"), "--restart-prep"],
      { cwd: dir, env: { ...process.env, MAW_SNAPSHOT_DIR: destination, MAW_SNAPSHOT_KEEP: "1000000" }, maxBuffer: 16 << 20 });
    const reported = /^wake plan:\s*(.+)$/m.exec(String(prep.stdout))?.[1].trim();
    if (!reported || dirname(reported) !== destination) throw new Error("restart-prep did not report a day-local wake plan");
    const snapshotText = readFileSync(join(destination, "latest.json"), "utf8");
    const snapshot = JSON.parse(snapshotText);
    if (!dryRun) return { wakePlan: reported, snapshot };
    const sourceJSON = join(destination, basename(realpathSync(join(destination, "latest.json"))));
    const wakePlan = join(fleetDir, "dry-run_wake-plan.md");
    const rewrite = (text: string) => text.split(sourceJSON).join(join(fleetDir, "dry-run_fleet.json"))
      .split(sourceJSON.replace(/\.json$/, ".md")).join(join(fleetDir, "dry-run_fleet.md"))
      .split(reported).join(wakePlan);
    writeFileSync(join(fleetDir, "dry-run_fleet.json"), snapshotText);
    writeFileSync(join(fleetDir, "dry-run_fleet.md"), rewrite(readFileSync(sourceJSON.replace(/\.json$/, ".md"), "utf8")));
    writeFileSync(wakePlan, rewrite(readFileSync(reported, "utf8")));
    return { wakePlan, snapshot };
  } finally {
    if (dryRun) rmSync(destination, { recursive: true, force: true });
  }
}
