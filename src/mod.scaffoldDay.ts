import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldVault } from "./mod.scaffoldVault";
import { tzTag } from "./mod.tzTag";

/** The /awaken-shaped skeleton + CLAUDE.md for one day repo. Shared by syncDayRepo
 *  (today) and the plan verb (a FUTURE day, pre-birthed so the plan has a home). */
export function scaffoldDay(dir: string, vault: string, repoSlug: string, fileSlug: string) {
  scaffoldVault(vault, ["memory/days"]);
  writeFileSync(join(dir, "CLAUDE.md"),
    `# ${repoSlug} — a day, kept\n\n` +
    `> One day of the fleet, captured as a repo. Written by 'maw today'\n` +
    `> (nat-build-with-oracle/maw-today).\n\n` +
    `A day capsule, not a project: the digest lives at ψ/memory/days/${fileSlug}.md,\n` +
    `and the /awaken-shaped vault holds whatever the day leaves behind — retros,\n` +
    `learnings, traces, handoffs. Times are local (${tzTag()}).\n\n` +
    `AI-generated per fleet Rule 6: assembled by an oracle, commissioned by Nat Weerawan.\n`);
}
