/** The proposal an idea is born with (Nat, 2026-09-07: "create proposal"). A template
 *  with the title filled and every other section a question — the capsule's job is to
 *  hold the answers as they come. `status: draft` until a human flips it; the code never
 *  claims an idea is more decided than it is. */
export function proposalMd(title: string, born: string, dayRepo: string): string {
  return `# Proposal — ${title}\n\n` +
    `born ${born} from ${dayRepo} · status: draft\n\n` +
    `## The idea\n\n${title}\n\n_(one paragraph: what it is, in plain words)_\n\n` +
    `## Why now\n\n_What today made this worth writing down._\n\n` +
    `## What it would take\n\n- [ ] first concrete step\n- [ ] \n\n` +
    `## Done when\n\n_The observable state that means this idea became real — or the reason it was let go._\n\n` +
    `## Notes\n\n_Links, sketches, prior art. Raw material goes in ψ/inbox._\n`;
}
