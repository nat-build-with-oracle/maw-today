import { type WorkerRow } from "./types";

export function parseWorkers(oracle: string, status: string, verify: string): WorkerRow[] {
  const blocks = new Map<string, string[]>();
  let name = "";
  for (const line of verify.split("\n")) {
    const header = /^── (.+) ──$/.exec(line.trim());
    if (header) { name = header[1]; blocks.set(name, []); }
    else if (name) blocks.get(name)!.push(line);
  }
  return status.split("\n").flatMap(line => {
    const m = /^\s*(\S+)\s+\[(main|wt)\]\s+(WORKING|idle)(?:\s+Context (\d+)% left)?\s*$/.exec(line);
    if (!m) return [];
    const block = blocks.get(m[1]);
    const ahead = !block || block.some(l => /no branch|fatal:|error:/.test(l)) ? null
      : block.filter(l => /^\s*[a-f0-9]{7,40}\s/.test(l)).length;
    return [{ oracle, worker: m[1], body: m[2], state: m[3],
      contextLeft: m[4] ? +m[4] : null, ahead, cwd: null,
      cwdCheck: "unknown", lastLine: null }];
  });
}
