import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { run, type Session } from "./types";
import { bytes } from "./mod.bytes";

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects/<encoded-cwd>/.
 * The encoded name is the project path with / and . replaced by -, so it decodes
 * back to something readable enough to group by.
 */
// With `until` (a past week), a session last written AFTER the window is not listed even
// if it ran inside it — mtime is the only clock a directory scan has.
export async function sessionsToday(since: number, until = Infinity): Promise<Session[]> {
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
        if (s.mtimeMs >= since && s.mtimeMs < until) {
          out.push({ project: d.replace(/^-/, "/").replace(/-/g, "/"), id: f.slice(0, 8), at: s.mtimeMs, bytes: s.size, file: join(root, d, f) });
        }
      } catch { /* vanished mid-scan; not fatal */ }
    }
  }
  out.sort((a, b) => a.at - b.at);

  // THE TYPED SPLIT — mtime is a liar's metric. Fleet listener bots and background
  // agents append tool results and heartbeats all day, so "18 sessions" reads as 18
  // working threads when the human drove 5 (Nat, 2026-09-01: "i just working with some
  // less than this list" — the same trap Odin's flights caught as idle-listener ghosts
  // and the +3600s batch-touch). "userType":"external" marks real keyboard input in
  // Claude Code jsonl; rg the WHOLE file, because a tail window misses a morning prompt
  // buried under an afternoon of appended tool results (this session's own jsonl grew
  // ~5MB/hour with zero typing). One rg spawn per candidate (~18/day), 8 at a time.
  try { await run("rg", ["--version"]); } catch { return out; }  // no ripgrep → no split; a flat list beats a misclassified one
  const CH = 8;
  for (let i = 0; i < out.length; i += CH) {
    await Promise.all(out.slice(i, i + CH).map(async (s) => {
      try {
        const q = s.file.replace(/'/g, `'\\''`);
        // "userType":"external" alone OVER-matches — hook summaries stamped
        // "type":"system", tool-result arrays, empty echo artifacts, skill/command
        // wrappers and task notifications ALL carry it (verified live: kvmbox's
        // 03:16 "typed" was an array-content relay, and the next survivor was a
        // stop_hook_summary). A real keyboard prompt is "type":"user" + external +
        // non-empty STRING content + no wrapper tag — the same false-positive
        // family Odin's sleipnir already paid for.
        const { stdout } = await run("sh",
          ["-c",
           `rg -NF --no-config '"type":"user"' '${q}' | ` +
           `rg -F '"userType":"external"' | ` +
           `rg -v '"content":(\\[|"")' | ` +
           `rg -vF -e '<command-message>' -e '<local-command' -e '<task-notification' -e '<system-reminder' | ` +
           `tail -1`],
          { maxBuffer: 4 << 20 });
        const line = stdout.trim();
        s.typedAt = line ? (Date.parse(JSON.parse(line).timestamp ?? "") || 0) : 0;
      } catch { s.typedAt = 0; }   // rg exits 1 on zero matches → genuinely never typed
    }));
  }
  return out;
}
