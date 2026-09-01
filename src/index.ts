// maw today — what happened on this machine today.
//
//   maw today                      sessions since local midnight (fast, one screen)
//   maw today commits              the nested per-repo commit listing (scans, ~seconds)
//   maw today gh                   the upstream half: PRs opened/merged + issues closed
//   maw today all                  all three
//   maw today --since 3d           widen the window (1d | 3d | 2h | YYYY-MM-DD)
//   maw today --json               machine-readable
//
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
//
// FLEET RULE, honoured deliberately: this NEVER walks the filesystem looking for
// repos. `ghq list` is the index and it is instant. No find, no bfs, no grep -r
// from a root — three incidents in three days froze m5 that way (CLAUDE.md).

import { execFile } from "node:child_process";
import { stat, readdir } from "node:fs/promises";
import { mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

type InvokeContext = {
  source?: string;
  args?: unknown;
  writer?: (...v: unknown[]) => unknown | PromiseLike<unknown>;
  signal?: AbortSignal;
};
type InvokeResult = { ok: boolean; output?: string; error?: string };

export const command = {
  name: "today",
  description: "What happened today — commits across the ghq tree, and sessions touched.",
};

// ---- args -------------------------------------------------------------------

const asArgs = (a: unknown): string[] =>
  Array.isArray(a) ? a.map(String) : typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [];

/**
 * Resolve --since to an epoch ms. Bare `1d`/`3d`/`2h` are relative; an ISO date is
 * absolute. Default is LOCAL midnight, not 24h ago — "today" is a calendar word, and
 * at 09:00 nobody means "since 09:00 yesterday".
 */
export function resolveSince(spec?: string): { at: number; label: string } {
  if (!spec) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { at: d.getTime(), label: "today" };
  }
  const rel = /^(\d+)([dhm])$/.exec(spec);
  if (rel) {
    const n = Number(rel[1]);
    const mult = rel[2] === "d" ? 86400e3 : rel[2] === "h" ? 3600e3 : 60e3;
    return { at: Date.now() - n * mult, label: `last ${spec}` };
  }
  // A bare date must mean LOCAL midnight: Date.parse("2026-09-01") is UTC midnight per
  // ECMAScript, which in +07 starts the window at 07:00 and silently drops the first
  // seven hours of the requested calendar day — while the label claims the full day.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec);
  if (ymd) return { at: new Date(+ymd[1], +ymd[2] - 1, +ymd[3]).getTime(), label: `since ${spec}` };
  const t = Date.parse(spec);
  if (!Number.isNaN(t)) return { at: t, label: `since ${spec}` };
  // An unparseable --since must not silently become "today" — that would report a
  // window the caller did not ask for and looks identical to success.
  throw new Error(`cannot parse --since "${spec}" — use 1d, 3h, or YYYY-MM-DD`);
}

// ---- commits ----------------------------------------------------------------

export type Commit = { repo: string; hash: string; at: number; subject: string; author: string };

async function ghqRepos(): Promise<string[]> {
  try {
    const { stdout } = await run("ghq", ["list", "-p"], { maxBuffer: 32 << 20 });
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Repos whose .git moved inside the window. See the header comment. */
async function candidates(repos: string[], since: number): Promise<string[]> {
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

async function commitsIn(repo: string, since: number): Promise<Commit[]> {
  try {
    // %x1f is a unit separator: subjects contain every other delimiter you might pick.
    const { stdout } = await run(
      "git",
      ["-C", repo, "log", "--all", "--no-merges", `--since=${new Date(since).toISOString()}`,
       "--pretty=format:%H%x1f%ct%x1f%an%x1f%s"],
      { maxBuffer: 8 << 20 },
    );
    return stdout.split("\n").filter(Boolean).map((line) => {
      const [hash, at, author, subject] = line.split("\x1f");
      return { repo, hash: hash.slice(0, 7), at: Number(at) * 1000, author, subject };
    });
  } catch {
    return [];
  }
}

/**
 * Gather commits. `onRepo` streams each repo's commits the moment its git log returns —
 * the feed path — while the sorted return value still serves --json and the TUI.
 */
export async function gitToday(
  since: number,
  onRepo?: (repo: string, commits: Commit[]) => void | Promise<void>,
  onScan?: (repoCount: number, candidateCount: number) => void | Promise<void>,
): Promise<Commit[]> {
  const repos = await ghqRepos();
  const cand = await candidates(repos, since);
  await onScan?.(repos.length, cand.length);
  const out: Commit[] = [];
  const CHUNK = 16; // process spawns, not stats — keep this small
  for (let i = 0; i < cand.length; i += CHUNK) {
    const slice = cand.slice(i, i + CHUNK);
    const batch = await Promise.all(slice.map((r) => commitsIn(r, since)));
    for (let j = 0; j < batch.length; j++) {
      await onRepo?.(slice[j], batch[j]);   // fires on zero commits too — a check is an event
      out.push(...batch[j]);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---- sessions ---------------------------------------------------------------

export type Session = { project: string; id: string; at: number; bytes: number; file: string };

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects/<encoded-cwd>/.
 * The encoded name is the project path with / and . replaced by -, so it decodes
 * back to something readable enough to group by.
 */
export async function sessionsToday(since: number): Promise<Session[]> {
  const root = join(homedir(), ".claude", "projects");
  const out: Session[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = (await readdir(join(root, d))).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const s = await stat(join(root, d, f));
        if (s.mtimeMs >= since) {
          out.push({ project: d.replace(/^-/, "/").replace(/-/g, "/"), id: f.slice(0, 8), at: s.mtimeMs, bytes: s.size, file: join(root, d, f) });
        }
      } catch { /* vanished mid-scan; not fatal */ }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---- github: the upstream half ----------------------------------------------

export type GhItem = {
  kind: "pr-opened" | "pr-merged" | "issue-closed";
  repo: string; number: number; title: string; author: string; at: number; url: string;
};

/** Fleet owners for the upstream search. Owner-scoped is LOAD-BEARING: `--involves`
 *  misses every bot/oracle-authored PR — probed 2026-09-01: owner-scoped on just 2 of
 *  6 orgs found MORE rows (11) than --involves across all of GitHub (9). All owners fit
 *  ONE query: GitHub's documented 5-clause cap is boolean operators, not repeated
 *  owner qualifiers (6 tested clean). */
const ghOwners = () => {
  // `||` not `??`: an EMPTY env var must fall back too — with ?? it would strip every
  // --owner flag and silently search all of GitHub, rendering strangers' PRs as the
  // fleet's day. Same guard on a whitespace-only value.
  const list = (process.env.MAW_TODAY_OWNERS || "laris-co,Soul-Brews-Studio,nat-build-with-oracle,DustBoy-PM25,FloodBoy-CM,nazt")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("MAW_TODAY_OWNERS is set but holds no owner — an ownerless search is all of GitHub");
  return list;
};

/**
 * PRs opened, PRs merged, issues closed since `since` — the Workshop-03 upstream half:
 * commits alone hid maw-js's sprint day (229 commits read as blobs until 198 opened /
 * 173 merged / 125 closed revealed a team closeout). Three parallel searches, ~3s wall,
 * 3 of the 30/min search budget. The date is a full ISO instant — honored server-side
 * (boundary-probed), so no bare-date UTC-midnight truncation trap.
 * THROWS on any failure instead of returning fake zeros: a category emptied by a
 * network error is exactly the false-zero Odin's flights exist to catch.
 */
export type GhDay = { items: GhItem[]; truncated: boolean };

export async function ghToday(since: number): Promise<GhDay> {
  const iso = `>=${new Date(since).toISOString()}`;
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
      at: Date.parse((kind === "pr-opened" ? r.createdAt : r.closedAt ?? r.updatedAt) ?? "") || 0,
      url: r.url ?? "",
    }));
    return { items, truncated: rows.length === LIMIT };
  };
  const [opened, merged, closed] = await Promise.all([
    search("prs", "--created", "pr-opened"),
    search("prs", "--merged-at", "pr-merged"),
    search("issues", "--closed", "issue-closed"),
  ]);
  // A PR opened AND merged today appears twice — that is two events, kept deliberately.
  return {
    items: [...opened.items, ...merged.items, ...closed.items].sort((a, b) => a.at - b.at),
    truncated: opened.truncated || merged.truncated || closed.truncated,
  };
}

export const GH_MARK: Record<GhItem["kind"], string> = {
  "pr-opened": "⇧ PR", "pr-merged": "✓ PR", "issue-closed": "⊘ issue",
};

const ghCounts = (gh: GhItem[]) => ({
  opened: gh.filter((g) => g.kind === "pr-opened").length,
  merged: gh.filter((g) => g.kind === "pr-merged").length,
  closed: gh.filter((g) => g.kind === "issue-closed").length,
});

// ---- digest -----------------------------------------------------------------

const hhmmLocal = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const lastTwo = (p: string) => p.split("/").slice(-2).join("/");
const fmtBytes = (n: number) => n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024) | 0}K` : `${(n / 1048576).toFixed(1)}M`;

/**
 * Write the day into the psi vault and return the path. ONE writer for both the
 * headless verb and the TUI's `w` key, so the report cannot drift between paths —
 * the drift-between-twins failure is this fleet's most repeated bug.
 * The report states its window (label): a day written from a partial window says so.
 */
/** The day's own vault: ghq/github.com/<org>/<slug>/ψ. The DAY REPO is the vault
 *  (Nat, 2026-09-01, superseding the psi-link destination): every digest lives with
 *  the day it describes, not in any host oracle's memory. */
export function dayVaultDir(): string {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const ghqRoot = execFileSync("ghq", ["root"], { encoding: "utf8" }).trim();
  const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
  return join(ghqRoot, "github.com", org, dayRepoSlug(), "ψ");
}

/** Human-readable gap: "6h33m" / "42m". */
const fmtGap = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

/** `gh` honesty levels: GhDay = gathered (items may be empty = a real zero; truncated
 *  makes counts floors) · null = tried and unreachable · undefined = this caller does
 *  not gather github. The digest SAYS which — a missing half must never read as a
 *  quiet day. */
export function writeDigest(commits: Commit[], sessions: Session[], label: string, vaultDir?: string, gh?: GhDay | null): string {
  const psi = vaultDir ?? dayVaultDir();
  // Day slug: "1-sep-tue-2026" — deliberately NOT ISO: these are for a human flipping
  // through a folder; the ls-sorting trade is accepted. Shared builder — see daySlug().
  const day = daySlug();
  const dir = join(psi, "memory", "days");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${day}.md`);
  const repos = new Set(commits.map((c) => c.repo)).size;
  const L: string[] = [];
  L.push(`# ${day} — ${label}`, "");
  // The window states itself, Huginn-style: a digest written at 17:10 must not read as
  // the whole day. Everything below is DETERMINISTIC — counts and gaps computed from
  // git/fs, no judgment. The narrative layer (why, retractions, friction) stays an
  // oracle's job; code only refuses to fake it.
  L.push(`window: ${label} · written ${hhmmLocal(Date.now())} ${tzTag()}`, "");
  const projects = new Set(sessions.map((s) => s.project)).size;
  L.push(`${commits.length} commits · ${repos} repos · ${sessions.length} sessions · ${projects} projects`);
  // The Workshop-03 canonical columns, one line: commits alone hide a sprint day.
  if (gh) {
    const n = ghCounts(gh.items);
    L.push(`upstream: ${n.opened} PRs opened · ${n.merged} merged · ${n.closed} issues closed` +
      (gh.truncated ? " — TRUNCATED at 1000/category, counts are floors" : ""));
  } else if (gh === null) L.push(`upstream: github unreachable this write — the gh half is MISSING, not zero`);
  else L.push(`upstream: not gathered by this writer`);
  L.push("");

  if (commits.length) {
    L.push(`## The day's shape`, "");
    // Commits folded onto hour-of-day. For the default "today" window that IS the day;
    // for --since 3d it is a fold and the window line above says so.
    const perHour = new Array<number>(24).fill(0);
    for (const c of commits) perHour[new Date(c.at).getHours()]++;
    const SPARK = "▁▂▃▄▅▆▇█";
    const peak = Math.max(...perHour);
    const bars = perHour.map((n) => n === 0 ? "·" : SPARK[Math.min(7, Math.ceil((n / peak) * 8) - 1)]).join("");
    // Ruler columns match bar columns: hour h sits at char h, so 06/12/18 land under
    // their bars and 23 hugs the right edge.
    L.push("```", `00    06    12    18  23`, bars,
           `peak ${String(perHour.indexOf(peak)).padStart(2, "0")}:00 — ${peak} commit${peak === 1 ? "" : "s"}`);
    // Droughts as stories: the longest silence between consecutive commits.
    if (commits.length >= 2) {
      let gap = 0, gi = 0;
      for (let i = 1; i < commits.length; i++) {
        const g = commits[i].at - commits[i - 1].at;
        if (g > gap) { gap = g; gi = i; }
      }
      if (gap >= 45 * 60000)
        L.push(`longest drought ${hhmmLocal(commits[gi - 1].at)} → ${hhmmLocal(commits[gi].at)} (${fmtGap(gap)})`);
    }
    L.push("```", "");

    // WHO DID WHAT — authors from git %an, honestly labeled: co-author trailers are not
    // captured (subject-only log), so "who" here is the committing author, no more.
    L.push(`## Who did what`, "", "```");
    const byAuthor = new Map<string, number>();
    for (const c of commits) byAuthor.set(c.author, (byAuthor.get(c.author) ?? 0) + 1);
    for (const [a, n] of [...byAuthor.entries()].sort((x, y) => y[1] - x[1]))
      L.push(`${String(n).padStart(4)}  ${a}`);
    L.push("```", "(authors from git %an — co-author trailers not counted)", "");
    const byRepo = new Map<string, number>();
    for (const c of commits) { const k = lastTwo(c.repo); byRepo.set(k, (byRepo.get(k) ?? 0) + 1); }
    const top = [...byRepo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    L.push("```");
    for (const [r, n] of top) L.push(`${String(n).padStart(4)}  ${r}`);
    L.push("```", "");
  }

  // The BRAID — Workshop-03's gold shape: commits, PRs, and issues merged onto ONE
  // timestamp axis so causality sits adjacent (issue-open next to its fixing commit
  // next to the PR-merge; a 13-minute bug→fix gap is visible here and in no
  // per-section view). Org headers were tried and produced repeats — time-sorted
  // events interleave orgs; the nested org view lives in `maw today commits`.
  L.push(`## Timeline`, "");
  const evs: { at: number; line: string }[] = commits.map((c) => ({
    at: c.at, line: `- ${hhmmLocal(c.at)} \`${c.hash}\` ${lastTwo(c.repo)} — ${c.subject}`,
  }));
  for (const g of gh?.items ?? [])
    evs.push({ at: g.at, line: `- ${g.at ? hhmmLocal(g.at) : "--:--"} **${GH_MARK[g.kind]}** [${g.repo}#${g.number}](${g.url}) — ${g.title} (${g.author})` });
  evs.sort((a, b) => a.at - b.at);
  for (const e of evs) L.push(e.line);
  L.push("", `## Sessions`, "");
  // The id is a LINK to the session's jsonl (file:// — clickable in VS Code/Obsidian;
  // inert on github.com, accepted: the digest is read locally, the repo is just its home).
  for (const s of sessions)
    L.push(`- ${hhmmLocal(s.at)} [\`${s.id}\`](file://${encodeURI(s.file)}) ${lastTwo(s.project)} (${fmtBytes(s.bytes)})`);
  L.push("", `_written by maw today digest, ${new Date().toISOString()}_`, "");
  writeFileSync(f, L.join("\n"));
  return f;
}

// ---- render -----------------------------------------------------------------

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const short = (p: string) => p.split("/").slice(-2).join("/");

const bytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}K` : `${(n / 1048576).toFixed(1)}M`;

function render(label: string, commits: Commit[] | null, sessions: Session[] | null): string {
  const L: string[] = [];
  L.push(`maw today — ${label}`);

  if (commits) {
    L.push("");
    if (!commits.length) {
      L.push("commits   none");
    } else {
      const repos = new Set(commits.map((c) => c.repo));
      L.push(`commits   ${commits.length} across ${repos.size} repo${repos.size === 1 ? "" : "s"}`);
      for (const c of commits) {
        L.push(`  ${hhmm(c.at)}  ${c.hash}  ${short(c.repo).padEnd(28)} ${c.subject.slice(0, 72)}`);
      }
    }
  }

  if (sessions) {
    L.push("");
    if (!sessions.length) {
      L.push("sessions  none");
    } else {
      const projects = new Set(sessions.map((s) => s.project));
      L.push(`sessions  ${sessions.length} across ${projects.size} project${projects.size === 1 ? "" : "s"}`);
      for (const s of sessions) {
        L.push(`  ${hhmm(s.at)}  ${s.id}  ${short(s.project).padEnd(28)} ${bytes(s.bytes)}`);
      }
    }
  }
  return L.join("\n");
}

// ---- entry ------------------------------------------------------------------

const since0 = (spec?: string) => resolveSince(spec).at;

/** "+07" style offset tag, derived — hardcoding it would lie on every other machine. */
export const tzTag = (d = new Date()) => {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? "+" : "-";
  return `${sign}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}${Math.abs(m) % 60 ? ":" + String(Math.abs(m) % 60).padStart(2, "0") : ""}`;
};

/** "1sep-tue" — daymonth-weekday, lowercase, local TZ. Nat's format (2026-09-01,
 *  revised same day from 1-sep-tue-2026). NOTE the accepted trade: without a year the
 *  slug recurs when the same date falls on the same weekday again (~5-11 years), and a
 *  day-repo of that name will already exist. Deliberate; flip by appending
 *  `-${d.getFullYear()}` here if that day ever comes. */
export function daySlug(d = new Date()): string {
  return `${d.getDate()}${d.toLocaleString("en", { month: "short" }).toLowerCase()}-` +
         d.toLocaleString("en", { weekday: "short" }).toLowerCase();
}

/** The day's REPO name — an oracle: "1sep-tue2026-oracle" (Nat, 2026-09-01). daySlug
 *  names the digest FILE inside; this names the repo/dir/remote that carries it. The
 *  year is present here (unlike daySlug) so repo names never collide across years, and
 *  the `-oracle` suffix marks it a member of the fleet, not a stray dated folder. */
export function dayRepoSlug(d = new Date()): string {
  return `${daySlug(d)}${d.getFullYear()}-oracle`;
}

/**
 * Create-or-refresh the day's PRIVATE repo and push. Extracted so three callers share
 * ONE body — the `new`/`repo` verbs and the default `maw today` auto-sync — because the
 * drift-between-twins bug (two paths doing the same job, one fixed) is this fleet's most
 * repeated. `mode` only changes the pre-flight guard:
 *   new    error if the day already exists (explicit "start today")
 *   repo   error if it does not exist yet (explicit "update today")
 *   auto   neither guard — create if missing, refresh if present (the bare `maw today`)
 */
async function syncDayRepo(
  ctx: InvokeContext,
  mode: "new" | "repo" | "auto",
  sinceSpec?: string,
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
    for (const d of ["inbox", "outbox", "writing", "lab", "archive",
                     "memory/resonance", "memory/learnings", "memory/retrospectives",
                     "memory/traces", "memory/days"])
      mkdirSync(join(vault, d), { recursive: true });
    for (const d of ["inbox", "outbox", "writing", "lab", "archive", "memory/resonance",
                     "memory/learnings", "memory/retrospectives", "memory/traces"])
      writeFileSync(join(vault, d, ".gitkeep"), "");
    writeFileSync(join(dir, "CLAUDE.md"),
      `# ${repoSlug} — a day, kept\n\n` +
      `> One day of the fleet, captured as a repo. Written by 'maw today'\n` +
      `> (neo-oracle, ψ/lab/maw-today), born the same day it describes.\n\n` +
      `A day capsule, not a project: the digest lives at ψ/memory/days/${fileSlug}.md,\n` +
      `and the /awaken-shaped vault holds whatever the day leaves behind — retros,\n` +
      `learnings, traces, handoffs. Times are local (${tzTag()}).\n\n` +
      `AI-generated per fleet Rule 6: assembled by an oracle, commissioned by Nat Weerawan.\n`);
  } else {
    await say(`▓ day repo exists — refreshing`);
  }

  await say(`▓ gathering the day…`);
  // Resolve the window ONCE — three since0() calls re-anchor relative specs to now()
  // milliseconds apart, and "the same window" should be literally the same number.
  const winAt = since0(sinceSpec);
  const [commits, sessions, gh] = await Promise.all([
    gitToday(winAt), sessionsToday(winAt),
    ghToday(winAt).catch(() => null),   // null = unreachable; digest says so
  ]);
  const f = writeDigest(commits, sessions, resolveSince(sinceSpec).label, vault, gh);
  const ghNote = gh
    ? (() => { const n = ghCounts(gh.items); return ` · ${n.opened}⇧ ${n.merged}✓ ${n.closed}⊘${gh.truncated ? " (floors)" : ""}`; })()
    : ` · gh unreachable`;
  await say(`▓ ${commits.length} commits · ${sessions.length} sessions${ghNote} → ${f}`);

  const git = (...a: string[]) => run("git", ["-C", dir, ...a]);
  try { await git("rev-parse", "--git-dir"); } catch { await git("init", "-q"); }
  await git("add", "-A");
  const staged = await git("diff", "--cached", "--quiet").then(() => false).catch(() => true);
  if (staged) {
    await git("commit", "-q", "-m",
      `day: ${fileSlug} — ${commits.length} commits · ${sessions.length} sessions\n\n` +
      `Written by maw today.\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`);
    await say(`▓ committed`);
  } else await say(`▓ nothing new to commit`);

  const remote = await run("gh", ["repo", "view", `${org}/${repoSlug}`, "--json", "name"]).then(() => true).catch(() => false);
  if (!remote) {
    // PRIVATE is load-bearing: the digest names private repos and their commit subjects.
    await run("gh", ["repo", "create", `${org}/${repoSlug}`, "--private", "--source", dir, "--push"]);
    await say(`▓ created PRIVATE github.com/${org}/${repoSlug} and pushed`);
  } else if (staged) {
    await git("push", "-u", "origin", "HEAD");
    await say(`▓ pushed`);
  }
  return { ok: true, output: buf.length ? buf.join("\n") : undefined };
}

export async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = asArgs(ctx.args);
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const json = args.includes("--json");
  // Default is the FIRST SECTION only (Nat, 2026-09-01): sessions are instant, while
  // the commit scan costs seconds and a screenful. The long nested listing lives under
  // its own verb; plain `maw today` answers at a glance.
  const verb = args.find((a) => !a.startsWith("--") && !["1d", "3d"].includes(a));
  const sub = verb ?? "sessions";
  // Bare `maw today` (no verb) shows the sessions glance, THEN auto-syncs the day repo
  // (Nat, 2026-09-01: "the output of maw today should show this first … then auto append").
  // An explicit `maw today sessions|commits|all` must NOT write — a read verb stays a read.
  const isDefault = verb === undefined && !json;

  // The TUI owns the terminal, so it cannot draw through this {ok, output} contract —
  // it runs as its own process, the same shape as atlas's bf-tui. But "inherit" is NOT
  // enough here: maw runs this handler with PIPED stdio (that is how writer streaming
  // works), so the child would inherit pipes and its TTY guard fires even in a real
  // terminal — observed live (`maw today tui` → "needs a real terminal"). Open the
  // controlling terminal itself and hand those fds to the child.
  // Spawn with PLAIN inherit even though maw's stdio is pipes: the TUI opens /dev/tty
  // itself (see tui.ts terminal IO). Passing tty fds through stdio here was tried and
  // is WORSE — Bun 1.3.14 leaves process.stdout undefined in a child with an fd-backed
  // stdout, and unrelated internals then throw in a WriteStream fast path.
  if (sub === "tui") {
    const { spawnSync } = await import("node:child_process");
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync("bun", [join(here, "tui.ts")], { stdio: "inherit" });
    return r.status === 0 ? { ok: true } : { ok: false, error: `tui exited ${r.status}` };
  }

  // The day as a PRIVATE repo — see syncDayRepo. `new` and `repo` are the strict doors
  // (Nat, 2026-09-01): `new` the deliberate birth, `repo` the update. The bare
  // `maw today` runs the same body in `auto` mode after the sessions view (below).
  if (sub === "new" || sub === "repo") return syncDayRepo(ctx, sub, flag("since"));

  if (sub === "digest") {
    const winAt = since0(flag("since"));   // once — see syncDayRepo
    const [commits, sessions, gh] = await Promise.all([
      gitToday(winAt), sessionsToday(winAt), ghToday(winAt).catch(() => null),
    ]);
    try {
      const f = writeDigest(commits, sessions, resolveSince(flag("since")).label, undefined, gh);
      return { ok: true, output: `${commits.length} commits · ${sessions.length} sessions\ndigest → ${f}` };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
  }

  if (!["all", "commits", "sessions", "gh"].includes(sub)) {
    return { ok: false, error: `unknown subcommand "${sub}" — use commits, sessions, gh, digest, new, repo, tui, or all` };
  }

  let since: { at: number; label: string };
  try {
    since = resolveSince(flag("since"));
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }

  const wantCommits = sub === "all" || sub === "commits";
  const wantSessions = sub === "all" || sub === "sessions";
  const wantGh = sub === "all" || sub === "gh";

  // --json stays a single blob — a consumer parsing a stream of fragments is worse
  // than a consumer waiting four seconds. gh failure surfaces as ghError, never as [].
  if (json) {
    const [commits, sessions, gh] = await Promise.all([
      wantCommits ? gitToday(since.at) : Promise.resolve(null),
      wantSessions ? sessionsToday(since.at) : Promise.resolve(null),
      wantGh ? ghToday(since.at).catch((e) => ({ ghError: String((e as Error).message) })) : Promise.resolve(null),
    ]);
    // gh mirrors commits/sessions symmetry: null when not requested AND on failure —
    // a consumer's `payload.gh ?? []` must never manufacture a false zero silently,
    // so failure carries ghError alongside the null.
    const payload: Record<string, unknown> = { since: since.at, label: since.label, commits, sessions, gh: null };
    if (wantGh && gh) {
      if ("items" in gh) { payload.gh = gh.items; payload.ghTruncated = gh.truncated; }
      else payload.ghError = (gh as { ghError: string }).ghError;
    }
    return { ok: true, output: JSON.stringify(payload, null, 2) };
  }

  // FEED, not report. The first version gathered everything and returned one string
  // through {ok, output} — four seconds of a blinking cursor that read as a freeze.
  // Same emit shape as jsonl-scanner: stream through ctx.writer when the host provides
  // one, buffer into output when it does not. Sessions land in ~0.5s, then each repo's
  // commits the moment its git log returns; the summary line anchors the end.
  const buf: string[] = [];
  const emit = async (line = "") => { if (ctx.writer) await ctx.writer(line); else buf.push(line); };

  await emit(`maw today — ${daySlug()}${since.label === "today" ? "" : ` · ${since.label}`} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} ${tzTag()}`);

  let sessions: Session[] | null = null;
  if (wantSessions) {
    sessions = await sessionsToday(since.at);
    await emit();
    if (!sessions.length) await emit("sessions  none");
    else {
      const projects = new Set(sessions.map((s) => s.project)).size;
      await emit(`sessions  ${sessions.length} across ${projects} project${projects === 1 ? "" : "s"}`);
      for (const s of sessions) await emit(`  ${hhmm(s.at)}  ${s.id}  ${short(s.project).padEnd(28)} ${bytes(s.bytes)}`);
    }
    if (!wantCommits) await emit(`\ncommits: maw today commits · both: maw today all · live: maw today tui`);
  }

  // Bare `maw today`: after the glance is flushed, auto-sync the day repo and append its
  // lines. syncDayRepo streams through the SAME ctx.writer, so the sessions view lands
  // first, then the ▓ create/refresh lines — the ordering Nat asked for.
  if (isDefault) {
    await emit();
    const r = await syncDayRepo(ctx, "auto", flag("since"));
    if (r.error) { const l = `✗ ${r.error}`; if (ctx.writer) await emit(l); else buf.push(l); }
    else if (!ctx.writer && r.output) buf.push(r.output);
  }

  let commits: Commit[] = [];
  if (wantCommits) {
    await emit();
    // NESTED: org → repo → commits. This nests without buffering because ghq list
    // returns paths SORTED, so candidates arrive with orgs contiguous — an org header
    // can be emitted exactly when the org changes, mid-stream. If the ordering source
    // ever changes, the symptom is repeated org headers, not lost commits.
    let lastOrg = "";
    commits = await gitToday(
      since.at,
      async (repo, cs) => {
        if (!cs.length) return;   // the feed shows results; the TUI shows the checking
        const parts = repo.split("/");
        const org = parts[parts.length - 2] ?? "";
        const name = parts[parts.length - 1] ?? repo;
        if (org !== lastOrg) { await emit(`${org}`); lastOrg = org; }
        await emit(`  ${name} — ${cs.length} commit${cs.length === 1 ? "" : "s"}`);
        for (const c of cs.sort((a, b) => a.at - b.at))
          await emit(`    ${hhmm(c.at)}  ${c.hash}  ${c.subject.slice(0, 78)}`);
      },
      (repoCount, candCount) => emit(`commits — checking ${candCount} of ${repoCount} repos with fresh .git…`),
    );
    const repos = new Set(commits.map((c) => c.repo)).size;
    await emit();
    await emit(`${commits.length} commit${commits.length === 1 ? "" : "s"} across ${repos} repo${repos === 1 ? "" : "s"}` +
      (sessions ? ` · ${sessions.length} session${sessions.length === 1 ? "" : "s"}` : ""));
  }

  // The upstream half — Workshop-03's missing columns. Failure prints as unreachable,
  // never as a quiet zero.
  if (wantGh) {
    await emit();
    try {
      const gh = await ghToday(since.at);
      const n = ghCounts(gh.items);
      await emit(`github    ${n.opened} PR${n.opened === 1 ? "" : "s"} opened · ${n.merged} merged · ${n.closed} issue${n.closed === 1 ? "" : "s"} closed` +
        (gh.truncated ? " — TRUNCATED at 1000/category, counts are floors" : ""));
      for (const g of gh.items)
        await emit(`  ${g.at ? hhmm(g.at) : "--:--"}  ${GH_MARK[g.kind].padEnd(7)} ${g.repo}#${g.number} — ${g.title.slice(0, 64)} (${g.author})`);
    } catch (e) {
      await emit(`github    unreachable — ${String((e as Error).message).split("\n")[0].slice(0, 100)}`);
    }
  }

  return { ok: true, output: buf.length ? buf.join("\n") : undefined };
}

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
