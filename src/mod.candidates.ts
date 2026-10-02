import { stat } from "node:fs/promises";
import { join } from "node:path";

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  WHY THE PREFILTER EXISTS — this is the whole design.                    │
// │                                                                          │
// │  `ghq list -p` returns 1,143 repos on m5 and costs ~2.7s by itself.      │
// │  Running `git log` in each would mean 1,143 process spawns for a command │
// │  meant to answer one question in under a second.                         │
// │                                                                          │
// │  So: stat <repo>/.git first — git bumps its mtime when a commit, fetch   │
// │  or checkout writes there — and spawn `git log` ONLY for repos whose      │
// │  .git moved inside the window. One stat is microseconds; a spawn is       │
// │  milliseconds. On a normal day that is ~1,140 stats and a handful of      │
// │  spawns.                                                                 │
// │                                                                          │
// │  The prefilter is deliberately LOOSE in one direction: .git can move      │
// │  without a commit (a fetch, an index refresh), so candidates get checked  │
// │  properly and may yield nothing. It must never be loose the other way —   │
// │  a commit always writes .git — which is why it is safe as a filter.       │
// └──────────────────────────────────────────────────────────────────────────┘

/** Repos whose .git moved inside the window. See the header comment. */
export async function candidates(repos: string[], since: number): Promise<string[]> {
  const hits: string[] = [];
  const CHUNK = 256; // bounded concurrency: 1,143 open handles at once is worse than 5 passes
  for (let i = 0; i < repos.length; i += CHUNK) {
    const slice = repos.slice(i, i + CHUNK);
    const marks = await Promise.all(
      slice.map(async (r) => {
        try {
          const s = await stat(join(r, ".git"));
          if (s.mtimeMs < since) return null;
          // SECOND STAGE — cut the fetch noise. .git dir mtime moves on FETCH_HEAD,
          // packed-refs, index …, so overnight fetches admitted 131 candidates of which
          // only 14 held commits (measured 2026-09-01, and the 14 fresh logs/HEAD were
          // exactly the 14 with commits — zero loss). logs/HEAD moves on commit and
          // checkout, not on plain fetch.
          try {
            const lh = await stat(join(r, ".git", "logs", "HEAD"));
            if (lh.mtimeMs >= since) return r;
          } catch { return r; }          // no reflog at all (rare) — keep, git log decides
          // A commit made in a LINKED WORKTREE reflogs into .git/worktrees/<n>/logs/HEAD,
          // not the main logs/HEAD — and this fleet runs --wt workers for real. If
          // worktrees exist, keep the repo rather than risk dropping their commits.
          try { await stat(join(r, ".git", "worktrees")); return r; } catch {}
          return null;
        } catch {
          return null; // not a repo any more, or unreadable — never fatal
        }
      }),
    );
    for (const m of marks) if (m) hits.push(m);
  }
  return hits;
}
