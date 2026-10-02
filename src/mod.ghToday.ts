import { run, type GhItem, type GhDay } from "./types";
import { ghOwners } from "./mod.ghOwners";

/**
 * PRs opened, PRs merged, issues closed since `since` — the Workshop-03 upstream half:
 * commits alone hid maw-js's sprint day (229 commits read as blobs until 198 opened /
 * 173 merged / 125 closed revealed a team closeout). Four parallel searches including issues opened for wrapup.
 * 4 of the 30/min search budget. The date is a full ISO instant — honored server-side
 * (boundary-probed), so no bare-date UTC-midnight truncation trap.
 * THROWS on any failure instead of returning fake zeros: a category emptied by a
 * network error is exactly the false-zero Odin's flights exist to catch.
 */
export async function ghToday(since: number, until?: number): Promise<GhDay> {
  const iso = until
    ? `${new Date(since).toISOString()}..${new Date(until - 1000).toISOString()}`
    : `>=${new Date(since).toISOString()}`;
  const owners = ghOwners().flatMap((o) => ["--owner", o]);
  // 1000 is gh's hard max. rows.length === LIMIT means MORE existed — the motivating
  // sprint day (198/173/125) fit inside the old 100 cap in NO category, and a saturated
  // page under best-match sort is an arbitrary subset. --sort created makes the kept
  // rows at least newest-first, and `truncated` turns every count into a stated floor.
  const LIMIT = 1000;
  const search = async (type: "prs" | "issues", dateFlag: string, kind: GhItem["kind"]) => {
    const { stdout } = await run("gh",
      ["search", type, dateFlag, iso, ...owners, "--sort", "created",
       "--json", "repository,number,title,author,createdAt,updatedAt,closedAt,url", "--limit", String(LIMIT)],
      { maxBuffer: 64 << 20 });
    const rows = JSON.parse(stdout) as any[];
    const items: GhItem[] = rows.map((r) => ({
      kind,
      repo: r.repository?.nameWithOwner ?? r.repository?.name ?? "?",
      number: r.number,
      title: r.title ?? "",
      author: r.author?.login ?? "?",
      // createdAt for opened; closedAt for merged/closed — for a merged PR closedAt IS
      // the merge instant, while updatedAt drifts to the last touch of any kind and
      // bends the braid's causality adjacency. 0 = unparseable, rendered "--:--",
      // never a fabricated plausible time.
      at: Date.parse((kind.endsWith("opened") ? r.createdAt : r.closedAt ?? r.updatedAt) ?? "") || 0,
      url: r.url ?? "",
    }));
    return { items, truncated: rows.length === LIMIT };
  };
  const [opened, merged, closed, issues] = await Promise.all([
    search("prs", "--created", "pr-opened"),
    search("prs", "--merged-at", "pr-merged"),
    search("issues", "--closed", "issue-closed"),
    search("issues", "--created", "issue-opened"),
  ]);
  // A PR opened AND merged today appears twice — that is two events, kept deliberately.
  return {
    items: [...opened.items, ...merged.items, ...closed.items, ...issues.items].sort((a, b) => a.at - b.at),
    truncated: opened.truncated || merged.truncated || closed.truncated || issues.truncated,
  };
}
