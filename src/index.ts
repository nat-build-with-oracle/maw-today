// maw today — what happened on this machine today.
//
//   maw today                      sessions since local midnight (fast, one screen)
//   maw today commits              the nested per-repo commit listing (scans, ~seconds)
//   maw today all                  both
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
import { join } from "node:path";
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

export type Session = { project: string; id: string; at: number; bytes: number };

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
          out.push({ project: d.replace(/^-/, "/").replace(/-/g, "/"), id: f.slice(0, 8), at: s.mtimeMs, bytes: s.size });
        }
      } catch { /* vanished mid-scan; not fatal */ }
    }
  }
  return out.sort((a, b) => a.at - b.at);
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
  const sub = args.find((a) => !a.startsWith("--") && !["1d", "3d"].includes(a)) ?? "sessions";

  // The TUI owns the terminal, so it cannot draw through this {ok, output} contract —
  // it runs as its own process with inherited stdio, the same shape as atlas's bf-tui.
  if (sub === "tui") {
    const { spawnSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync("bun", [join(here, "tui.ts")], { stdio: "inherit" });
    return r.status === 0 ? { ok: true } : { ok: false, error: `tui exited ${r.status}` };
  }

  if (!["all", "commits", "sessions"].includes(sub)) {
    return { ok: false, error: `unknown subcommand "${sub}" — use commits, sessions, tui, or all` };
  }

  let since: { at: number; label: string };
  try {
    since = resolveSince(flag("since"));
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }

  const wantCommits = sub === "all" || sub === "commits";
  const wantSessions = sub === "all" || sub === "sessions";

  // --json stays a single blob — a consumer parsing a stream of fragments is worse
  // than a consumer waiting four seconds.
  if (json) {
    const [commits, sessions] = await Promise.all([
      wantCommits ? gitToday(since.at) : Promise.resolve(null),
      wantSessions ? sessionsToday(since.at) : Promise.resolve(null),
    ]);
    return { ok: true, output: JSON.stringify({ since: since.at, label: since.label, commits, sessions }, null, 2) };
  }

  // FEED, not report. The first version gathered everything and returned one string
  // through {ok, output} — four seconds of a blinking cursor that read as a freeze.
  // Same emit shape as jsonl-scanner: stream through ctx.writer when the host provides
  // one, buffer into output when it does not. Sessions land in ~0.5s, then each repo's
  // commits the moment its git log returns; the summary line anchors the end.
  const buf: string[] = [];
  const emit = async (line = "") => { if (ctx.writer) await ctx.writer(line); else buf.push(line); };

  await emit(`maw today — ${since.label}`);

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
