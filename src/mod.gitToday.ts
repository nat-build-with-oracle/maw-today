import { type Commit } from "./types";
import { candidates } from "./mod.candidates";
import { commitsIn } from "./mod.commitsIn";
import { ghqRepos } from "./mod.ghqRepos";

/**
 * Gather commits. `onRepo` streams each repo's commits the moment its git log returns —
 * the feed path — while the sorted return value still serves --json and the TUI.
 */
export async function gitToday(
  since: number,
  onRepo?: (repo: string, commits: Commit[]) => void | Promise<void>,
  onScan?: (repoCount: number, candidateCount: number) => void | Promise<void>,
  strict = false,
  until?: number,
): Promise<Commit[]> {
  const repos = await ghqRepos();
  const cand = await candidates(repos, since);
  await onScan?.(repos.length, cand.length);
  const out: Commit[] = [];
  const CHUNK = 16; // process spawns, not stats — keep this small
  for (let i = 0; i < cand.length; i += CHUNK) {
    const slice = cand.slice(i, i + CHUNK);
    const batch = await Promise.all(slice.map((r) => commitsIn(r, since, strict, until)));
    for (let j = 0; j < batch.length; j++) {
      await onRepo?.(slice[j], batch[j]);   // fires on zero commits too — a check is an event
      out.push(...batch[j]);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
