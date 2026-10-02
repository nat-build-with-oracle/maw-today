import { join } from "node:path";
import { homedir } from "node:os";
import { sessionInventory, type SessionNode } from "./session-chain";
import { type InvokeResult, type Flag } from "./types";
import { bytes } from "./mod.bytes";
import { resolveSince } from "./mod.resolveSince";
import { short } from "./mod.short";
import { since0 } from "./mod.since0";

// LS — every jsonl touched today, Claude + Codex, read-only (Nat, 2026-09-12: "list
// all jsonl updated today"). Reuses `wrapup`'s liveness detection (session-chain.ts:
// bounded three-tier walk, never a filesystem sweep) with NO fleet snapshot — `ls` is
// a look, not a sweep of every oracle's tmux panes, so tmux/worker-vs-lead refinement
// is skipped and role stays whatever the file's own shape says (lead/subagent/
// workflow_agent from Claude, lead from Codex — see sessionInventory's fleet-matching
// pass, which only runs when a session is actually passed).
export async function cmdLs(flag: Flag, json: boolean): Promise<InvokeResult> {
  const winAt = since0(flag("since"));
  const nodes = await sessionInventory(join(homedir(), ".claude/projects"), join(homedir(), ".codex/sessions"), winAt, Date.now(), {});
  const label = resolveSince(flag("since")).label;
  if (json) return { ok: true, output: JSON.stringify({ since: winAt, label, nodes }, null, 2) };
  // sessionInventory sorts ascending (its own tree-render in `wrapup` wants that) —
  // that puts every null-start node (touched today, no event actually IN today's
  // window — "mtime is a liar's metric") FIRST, which reads as "everything is
  // --:--" at a glance. Re-sort here, most recent first, nulls last: for a plain
  // look at today, recency is what a human scans for.
  const view = [...nodes].sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  const counts = (k: "role" | "engine") => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n[k], (m.get(n[k]) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => `${v} ${k}`).join(" · ");
  };
  const lines: string[] = [`maw today ls — ${nodes.length} jsonl ${label === "today" ? "since local midnight" : label}` +
    (nodes.length ? ` (${counts("engine")} — ${counts("role")})` : "")];
  if (!nodes.length) lines.push("", "none");
  else {
    // Fixed column widths so every row lines up under the header — the plain
    // padEnd-without-a-cap that shipped first let a long repo name push the rest of
    // the row into a terminal wrap, which read as "which field is which?" (Nat,
    // 2026-09-13). `trunc` caps instead of just padding.
    const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;
    const col = (s: string, n: number) => trunc(s, n).padEnd(n);
    const MARK: Record<SessionNode["role"], string> = { lead: "●", worker: "▮", subagent: "▯", workflow_agent: "▫" };
    lines.push("",
      `  start  · id        ${col("engine", 11)} ${col("role", 14)} ${col("project", 26)} ${col("size", 7)} msgs  title`);
    for (const n of view) {
      const t = n.start ? n.start.slice(11, 16) : "--:--";
      // No Codex equivalent to Claude's ai-title exists (see SessionNode.title) —
      // blank here, never a guessed excerpt standing in unlabeled.
      lines.push(`  ${t}  ${MARK[n.role]} ${n.id}  ${col(n.engine, 11)} ${col(n.role, 14)} ${col(short(n.cwd ?? n.path), 26)} ${col(bytes(n.size), 7)} ${String(n.humanMsgs || "").padStart(4)}  ${trunc(n.title ?? "", 70)}` +
        (n.malformedLines ? `  [${n.malformedLines} malformed]` : ""));
    }
  }
  return { ok: true, output: lines.join("\n") };
}
