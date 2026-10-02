import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSessionFiles, sessionInventory, renderSessions } from "./session-chain";

test("three tiers, journal exclusion, clocks, worker parent and no transcript output", async () => {
  const root = mkdtempSync(join(tmpdir(), "session-chain-"));
  const claude = join(root, "claude"), codex = join(root, "codex");
  const lead = join(claude, "project", "abcdefgh-lead.jsonl");
  const sub = join(claude, "project", "abcdefgh-lead", "subagents", "agent-sub123456.jsonl");
  const workflow = join(claude, "project", "abcdefgh-lead", "subagents", "workflows", "wf_1", "agent-work1234.jsonl");
  const worker = join(codex, "2026", "09", "05", "rollout-worker.jsonl");
  const save = (p: string, events: unknown[]) => {
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  };
  const event = { timestamp: "2026-09-05T10:12:34Z", type: "user", cwd: "/day", message: { content: "SECRET transcript never emitted" } };
  try {
    save(lead, [event, { ...event, timestamp: "2026-09-06T10:00:00Z" }]);
    save(sub, [event]); save(workflow, [event]);
    save(join(claude, "project", "journal.jsonl"), [event]);
    save(join(claude, "project", "abcdefgh-lead", "subagents", "journal.jsonl"), [event]);
    save(worker, [{ type: "session_meta", payload: { id: "worker12-full", cwd: "/day/ψ/lab/01-work" } }, { type: "session_meta", payload: { id: "inherited-must-not-replace" } }, { timestamp: event.timestamp, type: "event_msg", payload: { type: "user_message" } }]);
    expect(await discoverSessionFiles(claude, codex)).toHaveLength(4);
    const nodes = await sessionInventory(claude, codex, Date.parse("2026-09-05T00:00:00Z"), Date.parse("2026-09-06T00:00:00Z"), { sessions: [{ name: "22-day", panes: [
      { name: "day", role: "lead", session_id: "abcdefgh", cwd: "/day" },
      { name: "01-work", role: "worker", session_id: "worker12", cwd: "/day/ψ/lab/01-work" },
    ] }] });
    expect(nodes).toHaveLength(4);
    expect(nodes.find(n => n.path === lead)).toMatchObject({ humanMsgs: 1, start: "2026-09-05 17:12:34 +07:00", end: "2026-09-05 17:12:34 +07:00" });
    expect(nodes.find(n => n.path === sub)?.parent).toBe(lead);
    expect(nodes.find(n => n.path === workflow)).toMatchObject({ parent: lead, workflow: "wf_1", role: "workflow_agent" });
    expect(nodes.find(n => n.path === worker)).toMatchObject({ parent: lead, role: "worker", tmux: "22-day:01-work" });
    expect(renderSessions(nodes)).toContain("  - sub12345 [subagent]");
    expect(JSON.stringify(nodes) + renderSessions(nodes)).not.toContain("SECRET");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Codex child uses first metadata identity and excludes inherited pre-birth events", async () => {
  const root = mkdtempSync(join(tmpdir(), "chain-codex-"));
  const day = join(root, "codex/2026/09/05"); mkdirSync(day, { recursive: true });
  const parent = join(day, "rollout-parent.jsonl"), child = join(day, "rollout-child.jsonl");
  const save = (p: string, events: any[]) => writeFileSync(p, events.map(e => JSON.stringify(e)).join("\n"));
  try {
    save(parent, [{ type: "session_meta", timestamp: "2026-09-05T09:00:00Z", payload: { id: "parent-id" } }]);
    save(child, [
      { type: "session_meta", timestamp: "2026-09-05T10:00:00Z", payload: { id: "child-id", source: { subagent: { thread_spawn: { parent_thread_id: "parent-id" } } } } },
      { type: "session_meta", timestamp: "2026-09-05T09:00:00Z", payload: { id: "parent-id" } },
      { type: "event_msg", timestamp: "2026-09-05T09:30:00Z", payload: { type: "user_message" } },
    ]);
    const nodes = await sessionInventory(join(root, "claude"), join(root, "codex"), Date.parse("2026-09-05T00:00:00Z"), Date.parse("2026-09-06T00:00:00Z"), {});
    expect(nodes.find(n => n.path === child)).toMatchObject({ fullId: "child-id", parent, role: "subagent", humanMsgs: 0, start: "2026-09-05 17:00:00 +07:00" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("title: Claude ai-title captured verbatim; Codex has no equivalent and stays null", async () => {
  const root = mkdtempSync(join(tmpdir(), "chain-title-"));
  const claude = join(root, "claude"), codex = join(root, "codex");
  const titled = join(claude, "titled", "abcd1234-lead.jsonl");
  const day = join(codex, "2026", "09", "05"); mkdirSync(day, { recursive: true });
  const untitled = join(day, "rollout-untitled.jsonl");
  const save = (p: string, events: unknown[]) => {
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  };
  try {
    save(titled, [
      { timestamp: "2026-09-05T10:00:00Z", type: "user", cwd: "/x" },
      { type: "ai-title", aiTitle: "SMTP service registration", sessionId: "abcd1234" },
    ]);
    save(untitled, [
      { type: "session_meta", timestamp: "2026-09-05T09:00:00Z", payload: { id: "untitled-id" } },
      { timestamp: "2026-09-05T09:00:01Z", type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text",
          text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nboilerplate\n</INSTRUCTIONS>\nfix the login bug" }] } },
    ]);
    const nodes = await sessionInventory(claude, codex, Date.parse("2026-09-05T00:00:00Z"), Date.parse("2026-09-06T00:00:00Z"), {});
    expect(nodes.find(n => n.path === titled)).toMatchObject({ title: "SMTP service registration" });
    expect(nodes.find(n => n.path === untitled)).toMatchObject({ title: null });
    expect(renderSessions(nodes)).toContain("SMTP service registration");
    expect(renderSessions(nodes)).not.toContain("AGENTS.md");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
