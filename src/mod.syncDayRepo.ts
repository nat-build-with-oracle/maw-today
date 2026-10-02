import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, type InvokeContext, type InvokeResult, type Commit, type Session, type GhDay } from "./types";
import { commitPushDay } from "./mod.commitPushDay";
import { dayRepoSlug } from "./mod.dayRepoSlug";
import { daySlug } from "./mod.daySlug";
import { ghCounts } from "./mod.ghCounts";
import { ghToday } from "./mod.ghToday";
import { gitToday } from "./mod.gitToday";
import { resolveSince } from "./mod.resolveSince";
import { scaffoldDay } from "./mod.scaffoldDay";
import { sessionsToday } from "./mod.sessionsToday";
import { since0 } from "./mod.since0";
import { writeDigest } from "./mod.writeDigest";

/**
 * Create-or-refresh the day's PRIVATE repo and push. Extracted so three callers share
 * ONE body — the `new`/`repo` verbs and the default `maw today` auto-sync — because the
 * drift-between-twins bug (two paths doing the same job, one fixed) is this fleet's most
 * repeated. `mode` only changes the pre-flight guard:
 *   new    error if the day already exists (explicit "start today")
 *   repo   error if it does not exist yet (explicit "update today")
 *   auto   neither guard — create if missing, refresh if present (the bare `maw today`)
 */
export async function syncDayRepo(
  ctx: InvokeContext,
  mode: "new" | "repo" | "auto",
  sinceSpec?: string,
  localOnly = false,
  gathered?: (gh: GhDay | null, commits: Commit[], sessions: Session[]) => void,
): Promise<InvokeResult> {
  const buf: string[] = [];
  const say = async (l: string) => { if (ctx.writer) await ctx.writer(l); else buf.push(l); };
  const repoSlug = dayRepoSlug();      // the repo/dir/remote — 1sep-tue2026-oracle
  const fileSlug = daySlug();          // the digest file inside — 1sep-tue.md
  const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
  let ghqRoot = "";
  try { ghqRoot = (await run("ghq", ["root"])).stdout.trim(); }
  catch { return { ok: false, error: "ghq not available — cannot place the day repo" }; }
  const dir = join(ghqRoot, "github.com", org, repoSlug);
  const vault = join(dir, "ψ");
  const scaffolded = existsSync(join(dir, "CLAUDE.md"));

  // Guard the two strict doors before touching disk. `new` on an existing day and
  // `repo` on a missing day are both user errors, not no-ops — say which door to use.
  if (mode === "new" && scaffolded)
    return { ok: false, error: `${org}/${repoSlug} already exists — use \`maw today repo\` to refresh it` };
  if (mode === "repo" && !scaffolded)
    return { ok: false, error: `no day repo yet for ${repoSlug} — use \`maw today new\` to create it` };

  if (!scaffolded) {
    await say(`▓ new day — scaffolding ${org}/${repoSlug}`);
    scaffoldDay(dir, vault, repoSlug, fileSlug);
  } else {
    await say(`▓ day repo exists — refreshing`);
  }

  await say(`▓ gathering the day…`);
  // Resolve the window ONCE — three since0() calls re-anchor relative specs to now()
  // milliseconds apart, and "the same window" should be literally the same number.
  const winAt = since0(sinceSpec);
  const [commits, sessions, gh] = await Promise.all([
    gitToday(winAt, undefined, undefined, localOnly), sessionsToday(winAt),
    ghToday(winAt).catch(() => null),   // null = unreachable; digest says so
  ]);
  gathered?.(gh, commits, sessions);
  const f = writeDigest(commits, sessions, resolveSince(sinceSpec).label, vault, gh, winAt);
  const ghNote = gh
    ? (() => { const n = ghCounts(gh.items); return ` · ${n.opened}⇧ ${n.merged}✓ ${n.closed}⊘${gh.truncated ? " (floors)" : ""}`; })()
    : ` · gh unreachable`;
  await say(`▓ ${commits.length} commits · ${sessions.length} sessions${ghNote} → ${f}`);

  if (!localOnly) await commitPushDay(dir, org, repoSlug,
    `day: ${fileSlug} — ${commits.length} commits · ${sessions.length} sessions`, say);
  return { ok: true, output: buf.length ? buf.join("\n") : undefined };
}
