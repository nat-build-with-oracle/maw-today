import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const run = promisify(execFile);

export type InvokeContext = {
  source?: string;
  args?: unknown;
  writer?: (...v: unknown[]) => unknown | PromiseLike<unknown>;
  signal?: AbortSignal;
  /** The name the user typed — "today", "td" or "week". maw-cli's js host sets it. */
  matchedName?: string;
};
export type InvokeResult = { ok: boolean; output?: string; error?: string };

/** The `--name value` reader handler builds over its args; the verb modules take it. */
export type Flag = (n: string) => string | undefined;

/** Everything the main window view (sessions / commits / gh / all) needs from handler. */
export type WindowOpts = {
  ctx: InvokeContext; flag: Flag; json: boolean; sub: string; name: string;
  week: boolean; weekSpec: string | undefined; yearSpec: string | undefined; isDefault: boolean;
};

// Verbs that read a window. The rest (wrapup, tui, new, repo, tomorrow, idea, ls,
// digest) are about one day or one repo, so `maw week <them>` is refused, not guessed.
export const WEEK_VERBS = new Set(["sessions", "commits", "gh", "all", "app"]);

export type Commit = { repo: string; hash: string; at: number; subject: string; author: string };

/** typedAt: last HUMAN keyboard input in the session (ms), 0 = none found, undefined =
 *  split unavailable (no ripgrep) — three honesty levels, same doctrine as gh. */
export type Session = { project: string; id: string; at: number; bytes: number; file: string; typedAt?: number };

export type GhItem = {
  kind: "pr-opened" | "pr-merged" | "issue-closed" | "issue-opened";
  repo: string; number: number; title: string; author: string; at: number; url: string;
};

export type GhDay = { items: GhItem[]; truncated: boolean };

export const GH_MARK: Record<GhItem["kind"], string> = {
  "pr-opened": "⇧ PR", "pr-merged": "✓ PR", "issue-closed": "⊘ issue", "issue-opened": "⇧ issue",
};

/** The /awaken vault skeleton every capsule this plugin births shares — a day, an idea.
 *  .gitkeep in each leaf so an empty vault survives git; `extra` dirs get none (a day's
 *  memory/days is filled by the digest the same moment it is made). */
export const VAULT_DIRS = ["inbox", "outbox", "writing", "lab", "archive", "memory/resonance",
                           "memory/learnings", "memory/retrospectives", "memory/traces"];

export type WorkerRow = {
  oracle: string; worker: string; body: string; state: string;
  contextLeft: number | null; ahead: number | null; cwd: string | null;
  cwdCheck: string; lastLine: string | null;
};
