#!/usr/bin/env bun
// maw today — TUI. A live terminal dashboard over the same gatherers the CLI uses.
//
//   bun src/tui.ts            directly, or:  maw today tui
//   keys: a/c/s view · j/k scroll · r refresh · +/- widen/narrow window · w write digest · q quit
//
// Pattern per the fleet's own precedent, not invented here: atlas ships cli/bf-tui.ts as a
// standalone bun script ("bun 1 ไฟล์, ANSI alt-screen" — its docs/ui-cookbook.md row 8), and
// m2/tui.mjs in the facebook-control lab reached the same shape from jsonl-lens. A TUI owns
// the terminal, so it runs as its OWN process; the plugin handler spawns it with inherited
// stdio rather than trying to draw through the {ok, output} contract.
//
// Hard TTY guard, same as bf-tui: piped stdin makes a TUI deaf (fleet learning
// 2026-05-12_clear-beats-pipe-for-tui).

import { spawnSync } from "node:child_process";
import { gitToday, sessionsToday, ghToday, resolveSince, writeDigest, daySlug, type Commit, type Session } from "./index.ts";

// ---- terminal IO ------------------------------------------------------------
// Run directly, stdin/stdout ARE the terminal. Run through maw, they are PIPES (that
// is how the handler's writer streaming works) — so fall back to opening /dev/tty
// ourselves. Note what does NOT work in Bun 1.3.14, probed before this was written:
// passing tty fds through spawnSync stdio leaves process.stdout undefined in the
// child, and `new tty.WriteStream(fd)` throws in its own fast path. What DOES work:
// writeSync to a /dev/tty fd, tty.ReadStream(fd) for raw keys, `stty size` (with the
// tty on ITS stdin) for dimensions, SIGWINCH to notice resizes.
import { openSync, writeSync } from "node:fs";
import tty from "node:tty";
import { execFileSync } from "node:child_process";

let IN: NodeJS.ReadStream;
let out: (s: string) => void;
let getSize: () => [number, number];

if (process.stdin.isTTY && process.stdout?.isTTY) {
  IN = process.stdin;
  out = (x) => { process.stdout.write(x); };
  getSize = () => [process.stdout.columns || 100, process.stdout.rows || 30];
  process.stdout.on("resize", () => draw());
} else {
  let inFd: number, outFd: number;
  try { inFd = openSync("/dev/tty", "r"); outFd = openSync("/dev/tty", "w"); }
  catch {
    console.error("maw today tui needs a real terminal (no /dev/tty) — pipes make a TUI deaf");
    process.exit(1);
  }
  IN = new tty.ReadStream(inFd) as unknown as NodeJS.ReadStream;
  out = (x) => { writeSync(outFd, x); };
  const measure = (): [number, number] => {
    try {
      const [r, c] = execFileSync("stty", ["size"], { stdio: [openSync("/dev/tty", "r"), "pipe", "ignore"], encoding: "utf8" })
        .trim().split(/\s+/).map(Number);
      return [c || 100, r || 30];
    } catch { return [100, 30]; }
  };
  let size = measure();
  getSize = () => size;
  process.on("SIGWINCH", () => { size = measure(); draw(); });
}

// ---- ansi -------------------------------------------------------------------
const ESC = "\x1b[";
const A = {
  altOn: `${ESC}?1049h${ESC}?25l`, altOff: `${ESC}?25h${ESC}?1049l`,
  clear: `${ESC}2J${ESC}H`,
  dim: `${ESC}2m`, bold: `${ESC}1m`, off: `${ESC}0m`, rev: `${ESC}7m`,
  cyan: `${ESC}36m`, grn: `${ESC}32m`, yel: `${ESC}33m`, mag: `${ESC}35m`,
};
const W = () => getSize()[0];
const H = () => getSize()[1];

// ---- display width ----------------------------------------------------------
// Ported from m2/tui.mjs, verified 12/12 there on a mixed Thai/CJK/emoji/ZWJ table.
// .length lies three ways in this data: commit subjects and project names carry Thai
// (combining marks = 0 columns), emoji (2), and occasionally CJK (2).
const colWidth = (ch: string): number => {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x200d) return -2;
  if (cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e)) return 0;
  if (/\p{Extended_Pictographic}/u.test(ch)) return 2;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0x20000 && cp <= 0x2fa1f)) return 2;
  return 1;
};
const wid = (s: string) => [...s].reduce((w, c) => w + colWidth(c), 0);
const cut = (s: string, n: number) => {
  let out = "", w = 0;
  for (const c of [...String(s ?? "")]) { const cw = colWidth(c); if (w + cw > n) break; out += c; w += cw; }
  return out;
};
const pad = (s: string, n: number) => { const t = cut(s, n); return t + " ".repeat(Math.max(0, n - wid(t))) };

/**
 * Clamp one RENDERED line to the terminal width, ANSI-aware. The plain cut() counts
 * escape sequences as width-1 characters, so it cannot be used on coloured lines.
 * WHY THIS EXISTS: any line one column too wide WRAPS, the whole frame shifts down a
 * row, and the header scrolls off the top of the alt screen — observed live on the
 * footer, whose key list was longer than the terminal was wide. Every line passes
 * through here before the frame is written; a too-long line degrades to truncation,
 * never to a wrap.
 */
function clampLine(line: string, width: number): string {
  let out = "", w = 0, i = 0;
  const chars = [...line];
  while (i < chars.length) {
    if (chars[i] === "\x1b") {                       // copy a full escape sequence, zero width
      let j = i + 1;
      if (chars[j] === "[") { j++; while (j < chars.length && !/[a-zA-Z]/.test(chars[j])) j++; j++; }
      out += chars.slice(i, j).join(""); i = j; continue;
    }
    const cw = colWidth(chars[i]);
    if (w + cw > width) break;
    out += chars[i]; w += cw; i++;
  }
  return i < chars.length ? out + A.off : out;       // never leave colour bleeding past a cut
}

// ---- state ------------------------------------------------------------------
type Row = { at: number; kind: "commit" | "session"; a: string; b: string; c: string; path?: string };

const S = {
  view: "all" as "all" | "commits" | "sessions",
  sinceSpec: undefined as string | undefined,   // undefined = local midnight
  label: "today",
  commits: [] as Commit[],
  sessions: [] as Session[],
  scroll: 0,
  cur: 0,                       // selected row — Enter acts on it
  loading: true,
  boot: [] as string[],         // the checking sequence, shown while loading
  loadedAt: 0,
  note: "",
  pick: null as Row | null,     // Enter arms this; the footer becomes a prompt
};

const short = (p: string) => p.split("/").slice(-2).join("/");
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const bytes = (n: number) => n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024) | 0}K` : `${(n / 1048576).toFixed(1)}M`;

function rows(): Row[] {
  const out: Row[] = [];
  if (S.view !== "sessions")
    for (const c of S.commits) out.push({ at: c.at, kind: "commit", a: c.hash, b: short(c.repo), c: c.subject, path: c.repo });
  if (S.view !== "commits")
    for (const s of S.sessions) out.push({ at: s.at, kind: "session", a: s.id, b: short(s.project), c: bytes(s.bytes) });
  return out.sort((x, y) => x.at - y.at);
}

// ---- draw -------------------------------------------------------------------
function draw() {
  const lines: string[] = [];
  const repoN = new Set(S.commits.map((c) => c.repo)).size;
  const projN = new Set(S.sessions.map((s) => s.project)).size;
  const left = ` ${A.bold}maw today${A.off} ${A.yel}${daySlug()}${A.off} ${A.dim}${S.label}${A.off}  ${A.grn}${S.commits.length}${A.off} commits/${repoN}  ${A.cyan}${S.sessions.length}${A.off} sessions/${projN}`;
  const right = S.loading ? `${A.yel}loading…${A.off} ` : `${A.dim}${hhmm(S.loadedAt)}${A.off} `;
  const leftW = wid(left.replace(/\x1b\[[0-9;]*m/g, ""));
  const rightW = wid(right.replace(/\x1b\[[0-9;]*m/g, ""));
  lines.push(left + " ".repeat(Math.max(1, W() - leftW - rightW)) + right);
  lines.push(`${A.dim}${"─".repeat(W())}${A.off}`);

  const view = H() - 4;
  if (S.loading) {
    // The boot sequence — the checking IS the show. Newest lines at the bottom,
    // tail-follow so a long scan scrolls like a feed rather than freezing.
    const tail = S.boot.slice(-view);
    if (!tail.length) lines.push(`  ${A.grn}▓${A.off} ${A.dim}waking…${A.off}`);
    for (const b of tail) lines.push(b);
  } else {
    const r = rows();
    S.cur = Math.max(0, Math.min(S.cur, r.length - 1));
    if (S.cur < S.scroll) S.scroll = S.cur;
    if (S.cur >= S.scroll + view) S.scroll = S.cur - view + 1;
    S.scroll = Math.max(0, Math.min(S.scroll, Math.max(0, r.length - view)));
    const slice = r.slice(S.scroll, S.scroll + view);
    if (!slice.length) lines.push(`  ${A.dim}nothing in this window${A.off}`);
    for (let i = 0; i < slice.length; i++) {
      const row = slice[i];
      const sel = S.scroll + i === S.cur;
      const tag = row.kind === "commit" ? `${A.grn}▮${A.off}` : `${A.cyan}▯${A.off}`;
      const body = row.kind === "commit"
        ? `${A.yel}${row.a}${A.off} ${pad(row.b, 26)} ${cut(row.c, Math.max(10, W() - 48))}`
        : `${A.mag}${row.a}${A.off} ${pad(row.b, 26)} ${A.dim}${row.c}${A.off}`;
      lines.push(`${sel ? A.rev + ">" : " "}${hhmm(row.at)} ${tag} ${body}${sel ? A.off : ""}`);
    }
  }
  while (lines.length < H() - 2) lines.push("");

  const note = S.note ? `${A.yel}${S.note}${A.off}  ` : "";
  lines.push(`${A.dim}${"─".repeat(W())}${A.off}`);
  lines.push(S.pick
    ? ` ${A.rev} ${short(S.pick.path!)} ${A.off}  ${A.yel}[w]${A.off} maw work — open/create workspace · ${A.yel}[a]${A.off} maw a — attach inside · ${A.dim}[esc] cancel${A.off}`
    : ` ${note}${A.dim}a all · c commits · s sessions · j/k move · ⏎ act on repo · r refresh · +/- window · w digest · q quit${A.off}`);
  // Clamp EVERY line: one wrap anywhere shifts the whole frame and loses the header.
  out(A.clear + lines.slice(0, H()).map((l) => clampLine(l, W())).join("\n"));
}

// ---- data -------------------------------------------------------------------
async function load() {
  S.loading = true; S.boot = []; draw();
  const since = resolveSince(S.sinceSpec);
  S.label = since.label;
  const say = (l: string) => { S.boot.push(l); draw(); };
  say(` ${A.grn}▓${A.off} scanning ghq tree…`);
  let checked = 0, total = 0;
  const [c, s] = await Promise.all([
    gitToday(
      since.at,
      (repo, cs) => {
        checked++;
        const mark = cs.length ? `${A.grn}[x]${A.off}` : `${A.dim}[·]${A.off}`;
        const n = cs.length ? ` ${A.grn}${cs.length} commit${cs.length === 1 ? "" : "s"}${A.off}` : `${A.dim} clean${A.off}`;
        say(` ${mark} ${String(checked).padStart(3)}/${total || "?"}  ${pad(short(repo), 40)}${n}`);
      },
      (repoCount, candCount) => {
        total = candCount;
        say(` ${A.grn}▓${A.off} ${repoCount} repos · ${A.grn}${candCount}${A.off} with fresh .git — checking…`);
      },
    ),
    sessionsToday(since.at),
  ]);
  S.commits = c; S.sessions = s; S.loading = false; S.loadedAt = Date.now();
  draw();
}

// widen/narrow: today → 3d → 7d → 30d and back. Bounded list, not arbitrary math —
// every step is a window a person actually asks for.
const WINDOWS = [undefined, "3d", "7d", "30d"] as const;
function stepWindow(dir: 1 | -1) {
  const i = WINDOWS.indexOf(S.sinceSpec as (typeof WINDOWS)[number]);
  const next = Math.max(0, Math.min(WINDOWS.length - 1, (i < 0 ? 0 : i) + dir));
  S.sinceSpec = WINDOWS[next];
  load();
}

// ---- digest -----------------------------------------------------------------
// Thin shim over the SHARED writer in index.ts — one format, two doors. Async because
// the digest gathers the gh half (three searches, ~3s): a TUI-written digest missing
// upstream while the verb-written one carries it is the drift-between-twins bug.
// gh failure passes null so the digest SAYS unreachable instead of faking a zero.
async function writeDigestNote(): Promise<string> {
  try {
    const since = resolveSince(S.sinceSpec);
    const gh = await ghToday(since.at).catch(() => null);
    return `digest → ${writeDigest(S.commits, S.sessions, S.label, undefined, gh, since.at)}`;
  } catch (e) { return String((e as Error).message); }
}

// ---- lifecycle --------------------------------------------------------------
// Last-resort restore: a crash must never leave a blank alt-screen with no cursor.
const restore = () => { try { out(A.altOff) } catch {} };
process.on("exit", restore);
process.on("uncaughtException", (e) => { restore(); console.error(e); process.exit(1); });
process.on("SIGINT", () => process.exit(0));

out(A.altOn);
IN.setRawMode!(true);
IN.resume();
IN.setEncoding("utf8");
// resize handling lives in the terminal-IO section: process.stdout "resize" when the
// process streams are the tty, SIGWINCH + stty when /dev/tty was opened by hand.

/** maw sessions are named after the oracle, so kvmbox-oracle attaches as `maw a kvmbox`. */
const attachName = (path: string) => path.split("/").pop()!.replace(/-oracle$/, "");

function act(cmd: "work" | "a", path: string) {
  restore();
  const arg = cmd === "a" ? attachName(path) : path;
  out(`\n→ maw ${cmd} ${arg}\n`);
  const r = spawnSync("maw", [cmd, arg], { stdio: "inherit" });
  if (r.status !== 0) out(`maw ${cmd} exited ${r.status} — cd ${path}\n`);
  process.exit(r.status === 0 ? 0 : 1);
}

IN.on("data", (key: string) => {
  S.note = "";
  // An armed prompt captures the keyboard until answered — the same keys mean
  // different things there, and leaking "w" through to the digest writer would be
  // a wrong action on a real repo.
  if (S.pick) {
    const path = S.pick.path!;
    if (key === "w") return act("work", path);
    if (key === "a") return act("a", path);
    S.pick = null; draw();       // esc, or anything else: cancel
    return;
  }
  switch (key) {
    case "q": case "\x03": process.exit(0);
    case "j": case `${ESC}B`: S.cur++; draw(); break;
    case "k": case `${ESC}A`: S.cur = Math.max(0, S.cur - 1); draw(); break;
    case "a": S.view = "all"; draw(); break;
    case "c": S.view = "commits"; draw(); break;
    case "s": S.view = "sessions"; draw(); break;
    case "r": load(); break;
    case "+": case "=": stepWindow(1); break;
    case "-": stepWindow(-1); break;
    case "w":
      S.note = "writing digest (gathering github…)"; draw();
      writeDigestNote().then((n) => { S.note = n; draw(); });
      break;
    case "\r": {
      // Arm the prompt, don't act yet. Only commit rows carry a real path; a session
      // row's project name is decoded from ~/.claude/projects/<encoded> where "-"
      // replaced "/", "." AND "-" alike, so a reconstructed path can be wrong — and
      // `maw work` on a wrong path creates a workspace on a typo. No path, no prompt.
      const row = rows()[S.cur];
      if (!row?.path) { S.note = "session rows have no exact path — pick a commit row"; draw(); break; }
      S.pick = row; draw();
      break;
    }
  }
});

await load();
