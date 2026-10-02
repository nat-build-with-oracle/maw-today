import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GH_MARK, type Commit, type Session, type GhDay } from "./types";
import { daySlug } from "./mod.daySlug";
import { dayVaultDir } from "./mod.dayVaultDir";
import { fmtBytes } from "./mod.fmtBytes";
import { fmtGap } from "./mod.fmtGap";
import { ghCounts } from "./mod.ghCounts";
import { hhmmLocal } from "./mod.hhmmLocal";
import { lastTwo } from "./mod.lastTwo";
import { tzTag } from "./mod.tzTag";

/**
 * Write the day into the psi vault and return the path. ONE writer for both the
 * headless verb and the TUI's `w` key, so the report cannot drift between paths —
 * the drift-between-twins failure is this fleet's most repeated bug.
 * The report states its window (label): a day written from a partial window says so.
 */
/** `gh` honesty levels: GhDay = gathered (items may be empty = a real zero; truncated
 *  makes counts floors) · null = tried and unreachable · undefined = this caller does
 *  not gather github. The digest SAYS which — a missing half must never read as a
 *  quiet day. */
export function writeDigest(commits: Commit[], sessions: Session[], label: string, vaultDir?: string, gh?: GhDay | null, sinceAt?: number): string {
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
  // Typed sessions (real keyboard input) lead with 👤; background files that merely
  // moved (listeners, agents, heartbeats) follow under their own label — see Session.typedAt.
  const sesLine = (s: Session, mark: string) =>
    `- ${mark}${hhmmLocal(s.at)} [\`${s.id}\`](file://${encodeURI(s.file)}) ${lastTwo(s.project)} (${fmtBytes(s.bytes)})`;
  const canSplit = sessions.every((s) => s.typedAt !== undefined);
  if (canSplit) {
    // The REAL window start, from the caller — guessing it from min(mtime) misfiles a
    // morning prompt whose file was last touched in the afternoon. Fallback = the
    // default window, local midnight.
    const winStart = sinceAt ?? new Date().setHours(0, 0, 0, 0);
    const typed = sessions.filter((s) => (s.typedAt ?? 0) >= winStart);
    const bgs = sessions.filter((s) => (s.typedAt ?? 0) < winStart);
    for (const s of typed) L.push(sesLine(s, "👤 "));
    if (bgs.length) {
      L.push("", `background — file moved, no typed input this window:`, "");
      for (const s of bgs) L.push(sesLine(s, ""));
    }
  } else for (const s of sessions) L.push(sesLine(s, ""));

  // What the day LEFT — ideas born from it by `maw today idea`, each a repo of its own,
  // pointed at from ψ/outbox/ideas/. Read from disk, not from memory: the pointer file is
  // the record, and a digest rewritten at 23:00 must still list a 07:00 idea.
  const ideasDir = join(psi, "outbox", "ideas");
  const ideas = existsSync(ideasDir) ? readdirSync(ideasDir).filter((f) => f.endsWith(".md")).sort() : [];
  if (ideas.length) {
    L.push("", `## Ideas`, "");
    for (const f of ideas) {
      const first = readFileSync(join(ideasDir, f), "utf8").split("\n")[0].replace(/^#\s*/, "");
      L.push(`- [${first}](../../outbox/ideas/${f})`);
    }
  }
  L.push("", `_written by maw today digest, ${new Date().toISOString()}_`, "");
  writeFileSync(f, L.join("\n"));
  return f;
}
