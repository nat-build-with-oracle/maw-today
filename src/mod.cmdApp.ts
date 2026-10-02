import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { InvokeResult, WindowOpts } from "./types";
import { cmdWindow } from "./mod.cmdWindow";

/** `maw today app` / `maw week app` — the window as a 3D scene in the browser (Nat,
 *  2026-10-02: "today app … web 3d"). A local server on 127.0.0.1 only: the page and
 *  /api/data, which is exactly `maw <name> all --json` for the same window, gathered
 *  per request so a reload is a refresh. Nothing leaves the machine except the page's
 *  own load of three.js. Runs until Ctrl-C. */
export async function cmdApp(opts: WindowOpts): Promise<InvokeResult> {
  const { flag, name } = opts;
  const pagePath = join(dirname(fileURLToPath(import.meta.url)), "app.html");
  const wanted = flag("port");
  const port = wanted === undefined ? 0 : Number(wanted);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return { ok: false, error: `--port needs a number 0–65535, got "${wanted}"\n  maw ${name} app --port 4777` };
  // One gather at a time, kept 30 s: a week's commit scan plus four gh searches takes
  // ~15 s, and two tabs or a double-click must not start two scans.
  let cached: { at: number; result: Promise<InvokeResult> } | undefined;
  const gather = () => {
    if (!cached || Date.now() - cached.at > 30_000)
      cached = { at: Date.now(), result: cmdWindow({ ...opts, ctx: { args: [] }, json: true, sub: "all", isDefault: false }) };
    return cached.result;
  };
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      idleTimeout: 255,   // Bun's default 10 s cuts the gather off mid-scan (seen live)
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/") return new Response(readFileSync(pagePath, "utf8"), { headers: { "content-type": "text/html; charset=utf-8" } });
        if (path === "/api/data") {
          const r = await gather();
          return r.ok
            ? new Response(r.output, { headers: { "content-type": "application/json" } })
            : new Response(JSON.stringify({ error: r.error }), { status: 500, headers: { "content-type": "application/json" } });
        }
        return new Response("not found", { status: 404 });
      },
    });
  } catch (e) {
    return { ok: false, error: `cannot listen on 127.0.0.1:${port}: ${(e as Error).message}\n  maw ${name} app --port 0` };
  }
  const url = `http://127.0.0.1:${server.port}/`;
  const say = (l: string) => opts.ctx.writer ? opts.ctx.writer(l) : console.log(l);
  await say(`maw ${name} app — ${url}   (Ctrl-C stops it)`);
  if (!opts.ctx.args || !(Array.isArray(opts.ctx.args) ? opts.ctx.args.map(String) : String(opts.ctx.args).split(/\s+/)).includes("--no-open"))
    spawn("open", [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  return new Promise<InvokeResult>((resolve) => {
    const stop = () => { server.stop(true); resolve({ ok: true }); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
