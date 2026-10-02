import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { proposalMd } from "./mod.proposalMd";
import { scaffoldVault } from "./mod.scaffoldVault";

/** The idea capsule: the shared vault skeleton, its own CLAUDE.md, a README — what
 *  github.com shows when browsing the org, so the title must be there — and PROPOSAL.md. */
export function scaffoldIdea(dir: string, repoSlug: string, title: string, born: string, dayRepo: string) {
  scaffoldVault(join(dir, "ψ"));
  writeFileSync(join(dir, "README.md"), `# ${title}\n\nborn ${born} from ${dayRepo} · \`${repoSlug}\` · [proposal](PROPOSAL.md)\n`);
  writeFileSync(join(dir, "PROPOSAL.md"), proposalMd(title, born, dayRepo));
  writeFileSync(join(dir, "CLAUDE.md"),
    `# ${repoSlug} — an idea, kept\n\n` +
    `> ${title}\n\n` +
    `Born ${born} from the day ${dayRepo}, by 'maw today idea'\n` +
    `(nat-build-with-oracle/maw-today).\n\n` +
    `An idea capsule, not yet a project: PROPOSAL.md says what it is, why now, what it\n` +
    `would take, and when it is done; the /awaken-shaped vault holds whatever the idea\n` +
    `grows — notes in ψ/inbox, drafts in ψ/writing, experiments in ψ/lab. If it\n` +
    `becomes real, /incubate or /awaken it from here; if it never does, it stays as the\n` +
    `record that the thought happened, and the day it came from knows it left one.\n\n` +
    `AI-generated per fleet Rule 6: assembled by an oracle, commissioned by Nat Weerawan.\n`);
}
