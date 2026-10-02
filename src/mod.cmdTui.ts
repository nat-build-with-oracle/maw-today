import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type InvokeResult } from "./types";

// The TUI owns the terminal, so it cannot draw through this {ok, output} contract —
// it runs as its own process, the same shape as atlas's bf-tui. But "inherit" is NOT
// enough here: maw runs this handler with PIPED stdio (that is how writer streaming
// works), so the child would inherit pipes and its TTY guard fires even in a real
// terminal — observed live (`maw today tui` → "needs a real terminal"). Open the
// controlling terminal itself and hand those fds to the child.
// Spawn with PLAIN inherit even though maw's stdio is pipes: the TUI opens /dev/tty
// itself (see tui.ts terminal IO). Passing tty fds through stdio here was tried and
// is WORSE — Bun 1.3.14 leaves process.stdout undefined in a child with an fd-backed
// stdout, and unrelated internals then throw in a WriteStream fast path.
export async function cmdTui(): Promise<InvokeResult> {
    const { spawnSync } = await import("node:child_process");
    const here = dirname(fileURLToPath(import.meta.url));
    const r = spawnSync("bun", [join(here, "tui.ts")], { stdio: "inherit" });
    return r.status === 0 ? { ok: true } : { ok: false, error: `tui exited ${r.status}` };
}
