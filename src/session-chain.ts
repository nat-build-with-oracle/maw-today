import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join } from "node:path";

export type SessionNode = {
  id: string; fullId: string; path: string; engine: string;
  role: "lead" | "worker" | "subagent" | "workflow_agent";
  parent: string | null; parentEvidence: string | null; workflow: string | null;
  tmux: string | null; cwd: string | null; start: string | null; end: string | null;
  humanMsgs: number; size: number; malformedLines: number;
};
type FileCandidate = { path: string; role: SessionNode["role"]; parent: string | null; workflow: string | null; engine: string };

async function entries(path: string) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
}

// SessionViewerCore/Ingest.swift:40–110: explicit three tiers, no recursive root walk.
export async function discoverSessionFiles(claudeRoot: string, codexRoot: string): Promise<FileCandidate[]> {
  const out: FileCandidate[] = [];
  const add = (path: string, role: SessionNode["role"], parent: string | null, workflow: string | null, engine = "claude") => {
    if (basename(path) !== "journal.jsonl") out.push({ path, role, parent, workflow, engine });
  };
  for (const project of await entries(claudeRoot)) {
    if (!project.isDirectory()) continue;
    const p = join(claudeRoot, project.name);
    for (const entry of await entries(p)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) add(join(p, entry.name), "lead", null, null);
      if (!entry.isDirectory()) continue;
      const parent = join(p, `${entry.name}.jsonl`), sub = join(p, entry.name, "subagents");
      for (const agent of await entries(sub)) {
        if (agent.isFile() && agent.name.endsWith(".jsonl")) add(join(sub, agent.name), "subagent", parent, null);
        if (!agent.isDirectory() || agent.name !== "workflows") continue;
        for (const run of await entries(join(sub, "workflows"))) {
          if (!run.isDirectory() || !run.name.startsWith("wf_")) continue;
          const runPath = join(sub, "workflows", run.name);
          for (const f of await entries(runPath)) {
            if (f.isFile() && /^agent-.*\.jsonl$/.test(f.name)) add(join(runPath, f.name), "workflow_agent", parent, run.name);
          }
        }
      }
    }
  }
  // Codex rollouts have a bounded YYYY/MM/DD layout; fleet matching happens below.
  for (const y of await entries(codexRoot)) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
    for (const m of await entries(join(codexRoot, y.name))) {
      if (!m.isDirectory() || !/^\d{2}$/.test(m.name)) continue;
      for (const d of await entries(join(codexRoot, y.name, m.name))) {
        if (!d.isDirectory() || !/^\d{2}$/.test(d.name)) continue;
        for (const f of await entries(join(codexRoot, y.name, m.name, d.name))) {
          if (f.isFile() && /^rollout-.*\.jsonl$/.test(f.name)) add(join(codexRoot, y.name, m.name, d.name, f.name), "lead", null, null, "codex");
        }
      }
    }
  }
  return out;
}

const bangkok = (at: number) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}).format(at) + " +07:00";

export async function sessionInventory(claudeRoot: string, codexRoot: string, since: number, until: number, fleet: any): Promise<SessionNode[]> {
  const nodes: SessionNode[] = [];
  const parentIds = new Map<string, string>();
  for (const f of await discoverSessionFiles(claudeRoot, codexRoot)) {
    const info = await stat(f.path);
    if (info.mtimeMs < since) continue;
    let fullId = basename(f.path, ".jsonl").replace(/^agent-/, "");
    let metadataSeen = false, role = f.role, ownStart = since;
    let cwd: string | null = null, first = Infinity, last = -Infinity, humanMsgs = 0, malformedLines = 0;
    const lines = createInterface({ input: createReadStream(f.path), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { malformedLines++; continue; }
      if (e.type === "session_meta" && !metadataSeen) {
        metadataSeen = true;
        const created = Date.parse(e.timestamp ?? "");
        if (Number.isFinite(created)) ownStart = Math.max(since, created);
        fullId = e.payload?.id ?? fullId; cwd = e.payload?.cwd ?? cwd;
        const parentId = e.payload?.source?.subagent?.thread_spawn?.parent_thread_id;
        if (parentId) { parentIds.set(f.path, parentId); role = "subagent"; }
      }
      if (!cwd) cwd = e.cwd ?? cwd;
      const at = Date.parse(e.timestamp ?? "");
      if (!Number.isFinite(at) || at < ownStart || at >= until) continue;
      first = Math.min(first, at); last = Math.max(last, at);
      const toolResult = Array.isArray(e.message?.content) && e.message.content.some((c: any) => c.type === "tool_result");
      if ((e.type === "user" && !e.isMeta && !toolResult) || (e.type === "event_msg" && e.payload?.type === "user_message")) humanMsgs++;
    }
    // Include files touched in the window even with no parseable event clock.
    if (!Number.isFinite(first) && !(info.mtimeMs >= since && info.mtimeMs < until)) continue;
    nodes.push({ id: fullId.slice(0, 8), fullId, path: f.path, engine: f.engine, role,
      parent: f.parent, parentEvidence: f.parent ? "filesystem subagents hierarchy" : null,
      workflow: f.workflow, tmux: null, cwd, start: Number.isFinite(first) ? bangkok(first) : null,
      end: Number.isFinite(last) ? bangkok(last) : null, humanMsgs, size: info.size, malformedLines });
  }
  for (const node of nodes) {
    const parentId = parentIds.get(node.path);
    if (!parentId) continue;
    const parents = nodes.filter(n => n.fullId === parentId);
    if (parents.length === 1) {
      node.parent = parents[0].path;
      node.parentEvidence = "Codex session_meta.source.subagent.thread_spawn.parent_thread_id";
    }
  }
  for (const session of fleet.sessions ?? []) {
    const matched = new Map<any, SessionNode>();
    for (const pane of session.panes ?? []) {
      const hits = nodes.filter(n => pane.session_id && n.fullId.startsWith(pane.session_id)
        && (!pane.cwd || !n.cwd || pane.cwd === n.cwd));
      if (hits.length !== 1) continue; // Never guess among colliding short IDs.
      const n = hits[0];
      matched.set(pane, n);
      n.tmux = `${session.name}:${pane.name}`;
      n.role = pane.role === "lead" ? "lead" : "worker";
      if (n.engine === "codex") n.engine = "omx/codex";
    }
    const leads = [...matched.entries()].filter(([p]) => p.role === "lead");
    if (leads.length !== 1) continue;
    for (const [pane, node] of matched) {
      if (pane.role !== "worker" || !/^\d{2}-/.test(pane.name)) continue;
      node.parent = leads[0][1].path;
      node.parentEvidence = "inferred: lab-slug worker in same tmux team; not proof of dispatch";
    }
  }
  return nodes.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.path.localeCompare(b.path));
}

const cell = (s: unknown) => String(s ?? "unknown").replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
export function renderSessions(nodes: SessionNode[]): string {
  const table = ["## Sessions", "", "Observed window times in Asia/Bangkok; null means unknown. Parent keys are full paths. Worker edges are team-based inferences, not verified dispatch events.", "",
    "| id | full .jsonl path | engine | role | tmux session:window | start | end | human msgs | size bytes |",
    "|---|---|---|---|---|---|---|---|---|",
    ...nodes.map(n => `| ${[n.id, n.path, n.engine, n.role, n.tmux, n.start, n.end, n.humanMsgs, n.size].map(cell).join(" | ")} |`)];
  const paths = new Set(nodes.map(n => n.path)), seen = new Set<string>();
  const tree: string[] = [];
  const visit = (n: SessionNode, depth: number) => {
    if (seen.has(n.path)) return;
    seen.add(n.path);
    tree.push(`${"  ".repeat(depth)}- ${cell(n.id)} [${n.role}${n.workflow ? ` / ${cell(n.workflow)}` : ""}] ${cell(n.tmux)} — ${cell(n.path)}${n.parent && !paths.has(n.parent) ? ` (parent not touched/discovered: ${cell(n.parent)})` : ""}`);
    for (const child of nodes.filter(c => c.parent === n.path)) visit(child, depth + 1);
  };
  for (const n of nodes.filter(n => !n.parent || !paths.has(n.parent))) visit(n, 0);
  for (const n of nodes) if (!seen.has(n.path)) visit(n, 0);
  return [...table, "", "### Session chain", "", ...tree].join("\n");
}
