import { GH_MARK, type InvokeResult, type WindowOpts, type Commit, type Session } from "./types";
import { bytes } from "./mod.bytes";
import { daySlug } from "./mod.daySlug";
import { ghCounts } from "./mod.ghCounts";
import { ghToday } from "./mod.ghToday";
import { gitToday } from "./mod.gitToday";
import { clockOn } from "./mod.clockOn";
import { groupByDay } from "./mod.groupByDay";
import { hhmm } from "./mod.hhmm";
import { parseWeekSpec } from "./mod.parseWeekSpec";
import { resolveSince } from "./mod.resolveSince";
import { sessionsToday } from "./mod.sessionsToday";
import { short } from "./mod.short";
import { syncDayRepo } from "./mod.syncDayRepo";
import { tzTag } from "./mod.tzTag";

export async function cmdWindow(o: WindowOpts): Promise<InvokeResult> {
  const { ctx, flag, json, sub, name, week, weekSpec, yearSpec, isDefault } = o;
  let since: { at: number; label: string };
  let until: number | undefined;   // set only for a past week; this week runs to now
  let span = daySlug();
  try {
    if (week && !flag("since")) {
      const wk = parseWeekSpec(weekSpec, yearSpec);
      since = { at: wk.start.getTime(), label: `week ${wk.tag}` };
      if (wk.end.getTime() <= Date.now()) until = wk.end.getTime();
      const last = new Date(Math.min(wk.end.getTime() - 1, Date.now()));
      span = `${wk.tag} · ${daySlug(wk.start)} → ${daySlug(last)}${wk.start.getFullYear() !== new Date().getFullYear() ? ` ${wk.start.getFullYear()}` : ""}`;
    } else since = resolveSince(flag("since"));
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
      wantCommits ? gitToday(since.at, undefined, undefined, false, until) : Promise.resolve(null),
      wantSessions ? sessionsToday(since.at, until) : Promise.resolve(null),
      wantGh ? ghToday(since.at, until).catch((e) => ({ ghError: String((e as Error).message) })) : Promise.resolve(null),
    ]);
    // gh mirrors commits/sessions symmetry: null when not requested AND on failure —
    // a consumer's `payload.gh ?? []` must never manufacture a false zero silently,
    // so failure carries ghError alongside the null.
    const payload: Record<string, unknown> = { since: since.at, ...(until ? { until } : {}), label: since.label, commits, sessions, gh: null };
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

  await emit(`maw ${name} — ${span}${since.label === "today" || since.label.startsWith("week ") ? "" : ` · ${since.label}`} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} ${tzTag()}`);

  let sessions: Session[] | null = null;
  if (wantSessions) {
    sessions = await sessionsToday(since.at, until);
    await emit();
    if (!sessions.length) await emit("sessions  none");
    else {
      const projects = new Set(sessions.map((s) => s.project)).size;
      const split = sessions.every((s) => s.typedAt !== undefined);
      const typed = split ? sessions.filter((s) => (s.typedAt ?? 0) >= since.at) : sessions;
      const bg = split ? sessions.filter((s) => (s.typedAt ?? 0) < since.at) : [];
      await emit(`sessions  ${sessions.length} across ${projects} project${projects === 1 ? "" : "s"}` +
        (split ? ` — ${typed.length} typed 👤 · ${bg.length} background` : ""));
      // A window longer than today (maw week, --since 3d) gets a header per day
      // (Nat, 2026-10-02: "can we know which day? section?"): rows sit under the day of
      // their last write and print a bare clock; one day keeps the flat list it had.
      const days = since.at < new Date().setHours(0, 0, 0, 0);
      const typedRow = (s: Session, day?: number) =>
        `  ${day === undefined ? hhmm(s.at) : clockOn(s.at, day)}  ${s.id}  ${short(s.project).padEnd(28)} ${bytes(s.bytes)}` +
        (split ? `  👤 ${day === undefined ? hhmm(s.typedAt!) : clockOn(s.typedAt!, day)}` : "");
      const bgRow = (s: Session, day?: number) =>
        `    ${day === undefined ? hhmm(s.at) : clockOn(s.at, day)}  ${s.id}  ${short(s.project).padEnd(26)} ${bytes(s.bytes)}`;
      if (!days) for (const s of typed) await emit(typedRow(s));
      else for (const [i, d] of groupByDay(typed, (s) => s.at).entries()) {
        if (i) await emit();   // a blank line closes each day before the next header
        await emit(`  ── ${d.label} · ${d.rows.length} ──`);
        for (const s of d.rows) await emit(typedRow(s, d.start));
      }
      if (bg.length) {
        await emit(`  background — file moved, no typed input this window (listeners, agents, heartbeats):`);
        if (!days) for (const s of bg) await emit(bgRow(s));
        else for (const [i, d] of groupByDay(bg, (s) => s.at).entries()) {
          if (i) await emit();
          await emit(`    ── ${d.label} · ${d.rows.length} ──`);
          for (const s of d.rows) await emit(bgRow(s, d.start));
        }
      }
    }
    if (!wantCommits) await emit(`\ncommits: maw ${name} commits · all: maw ${name} all${week ? " · today: maw week today" : " · live: maw today tui · week: maw week"}`);
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
      false,
      until,
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
      const gh = await ghToday(since.at, until);
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
