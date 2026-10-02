import { writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { sessionInventory, renderSessions } from "./session-chain";
import { buildWrapupBundle } from "./wrapup-bundle";
import { run, type InvokeResult, type Commit, type Session, type GhDay, type WorkerRow } from "./types";
import { cell } from "./mod.cell";
import { charterBullets } from "./mod.charterBullets";
import { commitPushDay } from "./mod.commitPushDay";
import { dayRepoSlug } from "./mod.dayRepoSlug";
import { daySlug } from "./mod.daySlug";
import { handler } from "./mod.handler";
import { parseWorkers } from "./mod.parseWorkers";
import { prepareFleet } from "./mod.prepareFleet";
import { since0 } from "./mod.since0";
import { sweepOracle } from "./mod.sweepOracle";
import { syncDayRepo } from "./mod.syncDayRepo";
import { workersTable } from "./mod.workersTable";

export async function wrapup(dryRun: boolean, json: boolean): Promise<InvokeResult> {
  try {
    const root = (await run("ghq", ["root"])).stdout.trim();
    const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
    const dir = join(root, "github.com", org, dayRepoSlug());
    // Refresh locally even in real mode: publication belongs AFTER all gathering.
    let github: GhDay | null = null;
    let dayCommits: Commit[] = [], daySessions: Session[] = [];
    const refreshed = await syncDayRepo({}, "repo", undefined, true, (g, c, s) => { github = g; dayCommits = c; daySessions = s; });
    if (!refreshed.ok) return refreshed;
    const fleetDir = join(dir, "ψ/memory/fleet");
    const { wakePlan, snapshot } = await prepareFleet(dir, fleetDir, dryRun);
    const sessions = await sessionInventory(join(homedir(), ".claude/projects"), join(homedir(), ".codex/sessions"), since0(), Date.now(), snapshot);
    const sessionsMarkdown = renderSessions(sessions);
    appendFileSync(wakePlan, `\n${sessionsMarkdown}\n`);
    const rows: WorkerRow[] = [], warnings: string[] = [], blockingErrors: string[] = [], charters: string[] = [];
    const repos = (await run("ghq", ["list", "-p"])).stdout.trim().split("\n").filter(Boolean);
    const sweep: Awaited<ReturnType<typeof sweepOracle>>[] = [];
    for (const repo of repos) {
      const teams = join(repo, "ψ/teams");
      if (!existsSync(join(teams, "justfile"))) continue;
      const result = await sweepOracle(repo);
      sweep.push(result);
      warnings.push(...result.warnings);
      blockingErrors.push(...result.blockingErrors);
      const { status, verify } = result;
      const local = parseWorkers(repo.slice(root.length + 1), status, verify);
      for (const row of local) {
        const panes = snapshot.sessions.flatMap((s: any) => s.panes).filter((p: any) =>
          p.name === row.worker && (p.repo === row.oracle || p.cwd === repo || p.cwd?.startsWith(repo + "/")));
        if (panes.length === 1) {
          row.cwd = panes[0].cwd;
          row.lastLine = panes[0].screen?.at(-1) ?? null;
          row.cwdCheck = !row.cwd ? "unknown" : [join(repo, "ψ/lab", row.worker), join(repo, "agents", row.worker, "ψ/lab", row.worker)].includes(row.cwd)
            ? "ok" : `MISMATCH: ${row.cwd}`;
        }
        const readme = join(repo, "ψ/lab", row.worker, "README.md");
        if (existsSync(readme)) {
          const lines = charterBullets(readFileSync(readme, "utf8"));
          charters.push(`### ${row.oracle} / ${row.worker}\nSource: ${readme}\n${lines.join("\n") || "Charter lines missing — escalate."}`);
        }
      }
      rows.push(...local);
    }
    if (!sweep.length) blockingErrors.push("Zero oracles swept");
    const oracleTable = ["| oracle | status | verify |", "|---|---|---|", ...sweep.map(s => `| ${cell(s.repo)} | ${s.statusCheck} | ${s.verifyCheck} |`)].join("\n");
    const table = workersTable(rows) + "\n\n### Oracle recipe coverage\n" + oracleTable;
    appendFileSync(wakePlan, `\n## Workers\n\n${table}\n\n${warnings.map(w => `- ${cell(w)}`).join("\n")}\n`);
    const gh = github as GhDay | null;
    if (!gh) blockingErrors.push("GitHub unavailable: issue list unknown; do not post comments.");
    if (gh?.truncated) warnings.push("GitHub results truncated: issue list incomplete; reconcile before commenting.");
    const issues = gh?.items.filter(g => g.kind === "issue-opened") ?? [];
    const prs = gh?.items.filter(g => g.kind === "pr-opened") ?? [];
    const digest = join(dir, "ψ/memory/days", `${daySlug()}.md`);
    const prompt = wakePlan.replace(/_wake-plan\.md$/, "_wrapup-prompt.md");
    const oracle = dayRepoSlug().replace(/-oracle$/, "");
    const lead = snapshot.sessions.find((s: any) => s.name.replace(/^\d+-/, "") === oracle);
    const sessionClocks = snapshot.sessions.flatMap((s: any) => s.panes.map((p: any) => ({
      session: s.name, worker: p.name, repo: p.repo, session_id: p.session_id,
      session_start: p.session_start, session_end: p.session_end,
      source: "maw-teams restart-prep: observed today's activity timestamps",
    })));
    writeFileSync(prompt, buildWrapupBundle({ now: new Date(), dir, slug: daySlug(), wakePlan,
      dryRun, signature: `[${lead?.name ?? "unknown"}:${oracle}]`,
      digest: readFileSync(digest, "utf8"), table, charters, warnings, blockingErrors,
      commits: dayCommits, sessions: daySessions, sessionInventory: sessions, sessionsMarkdown, issues, prs, rows, sessionClocks, sweptCount: sweep.length,
    }));
    if (!dryRun) {
      if (blockingErrors.length) throw new Error(`Gathering incomplete; no publication: ${blockingErrors.join("; ")}. Prompt: ${prompt}`);
      const tomorrow = await handler({ args: ["tomorrow"] });
      if (!tomorrow.ok) return tomorrow;
      await commitPushDay(dir, org, dayRepoSlug(), `day: ${daySlug()} — wrapup`, async () => {});
    }
    const afterReboot = [`cd ${dir}`, `cat ${wakePlan}`, "Say I'm back → /maw-wake"];
    return { ok: true, output: json ? JSON.stringify({ dryRun, dayRepo: dir, wakePlan, prompt, rows, sessions, warnings, blockingErrors, oracleResults: sweep.map(({ repo, statusCheck, verifyCheck }) => ({ repo, statusCheck, verifyCheck })), sweptRepos: sweep.map(s => s.repo), afterReboot }, null, 2)
      : `${dryRun ? "DRY RUN — no commit/push/tomorrow" : "Wrapup complete"}\n${table}\nprompt: ${prompt}\n${afterReboot.join("\n")}` };
  } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
