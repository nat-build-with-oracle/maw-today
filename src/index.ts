// maw today — what happened on this machine today.
//
//   maw today                      sessions since local midnight (fast, one screen)
//   maw today commits              the nested per-repo commit listing (scans, ~seconds)
//   maw today gh                   the upstream half: PRs opened/merged + issues closed
//   maw today all                  all three
//   maw today --since 3d           widen the window (1d | 3d | 2h | YYYY-MM-DD)
//   maw today --json               machine-readable
//   maw today tomorrow             pre-birth tomorrow's day repo
//   maw today idea <title>         birth an idea capsule — PRIVATE repo idea-7sep-mon2026-<slug>, linked from today
//   maw today ls                   every jsonl touched today — Claude + Codex, read-only, full liveness detection
//   maw week [sessions|commits|gh|all]  the same views since local Monday 00:00 — read-only
//   maw week 39 · maw week 2025W40 · maw week 40 --year 2025   a past ISO week, Monday to Monday
//   maw week today                 exactly maw today (also: maw today week = maw week)
//   maw today app · maw week app   the same window as a 3D page on 127.0.0.1 (--port N, --no-open)
//
// FLEET RULE, honoured deliberately: this NEVER walks the filesystem looking for
// repos. `ghq list` is the index and it is instant. No find, no bfs, no grep -r
// from a root — three incidents in three days froze m5 that way (CLAUDE.md).

import { handler } from "./mod.handler";

export const command = {
  name: "today",
  description: "What happened today — commits across the ghq tree, and sessions touched.",
};

export type { Commit, Session, GhItem, GhDay, WorkerRow } from "./types";
export { GH_MARK } from "./types";
export { resolveSince } from "./mod.resolveSince";
export { weekStart } from "./mod.weekStart";
export { isoWeek } from "./mod.isoWeek";
export { isoWeekStart } from "./mod.isoWeekStart";
export { parseWeekSpec } from "./mod.parseWeekSpec";
export { splitWeek } from "./mod.splitWeek";
export { gitToday } from "./mod.gitToday";
export { sessionsToday } from "./mod.sessionsToday";
export { ghToday } from "./mod.ghToday";
export { dayVaultDir } from "./mod.dayVaultDir";
export { writeDigest } from "./mod.writeDigest";
export { tzTag } from "./mod.tzTag";
export { daySlug } from "./mod.daySlug";
export { dayRepoSlug } from "./mod.dayRepoSlug";
export { ideaSlug } from "./mod.ideaSlug";
export { ideaRepoSlug } from "./mod.ideaRepoSlug";
export { proposalMd } from "./mod.proposalMd";
export { parseWorkers } from "./mod.parseWorkers";
export { workersTable } from "./mod.workersTable";
export { charterBullets } from "./mod.charterBullets";
export { prepareFleet } from "./mod.prepareFleet";
export { sweepOracle } from "./mod.sweepOracle";
export { handler };

export default handler;

// Runnable directly (bun src/index.ts commits) as well as through maw, so the plugin
// can be tested before it is installed — the install step is where the fleet's known
// packaging bug lives, and it should not be in the way of a first run.
if (import.meta.main) {
  // Pass a writer so the direct run streams exactly like the maw-hosted run — without
  // it the handler falls back to buffering and the freeze this feed exists to kill
  // comes back on the `bun src/index.ts` path only, which is the worst kind of parity bug.
  const r = await handler({
    source: "cli",
    args: process.argv.slice(2),
    writer: (...v: unknown[]) => { console.log(v.map(String).join(" ")); },
  });
  if (r.output) console.log(r.output);
  if (r.error) console.error(r.error);
  process.exit(r.ok ? 0 : 1);
}
