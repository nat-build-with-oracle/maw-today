import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, type InvokeContext, type InvokeResult, type Flag } from "./types";
import { commitPushDay } from "./mod.commitPushDay";
import { dayRepoSlug } from "./mod.dayRepoSlug";
import { daySlug } from "./mod.daySlug";
import { scaffoldDay } from "./mod.scaffoldDay";

// TOMORROW — maw today, but for the day ahead (Nat, 2026-09-01): pre-birth the
// day repo so tomorrow already exists when it starts. Same vault, same PRIVATE
// repo, NO extra files — whatever belongs in tomorrow goes into its ψ by hand.
// --date YYYY-MM-DD aims at any day; default is tomorrow.
export async function cmdTomorrow(ctx: InvokeContext, flag: Flag): Promise<InvokeResult> {
  const buf2: string[] = [];
  const say = async (l: string) => { if (ctx.writer) await ctx.writer(l); else buf2.push(l); };
  const dateSpec = flag("date");
  let target = new Date();
  if (dateSpec) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateSpec);
    if (!m) return { ok: false, error: `cannot parse --date "${dateSpec}" — use YYYY-MM-DD` };
    target = new Date(+m[1], +m[2] - 1, +m[3]);
    // JS Date NORMALIZES instead of failing — 2026-13-40 quietly becomes 2027-02-09
    // (this bug birthed a real repo in testing). A date is real only if it round-trips.
    if (target.getFullYear() !== +m[1] || target.getMonth() + 1 !== +m[2] || target.getDate() !== +m[3])
      return { ok: false, error: `not a real date: "${dateSpec}"` };
  } else target.setDate(target.getDate() + 1);
  const repoSlug = dayRepoSlug(target), fileSlug = daySlug(target);
  const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
  let ghqRoot = "";
  try { ghqRoot = (await run("ghq", ["root"])).stdout.trim(); }
  catch { return { ok: false, error: "ghq not available — cannot place the day repo" }; }
  const dir = join(ghqRoot, "github.com", org, repoSlug);
  if (existsSync(join(dir, "CLAUDE.md")))
    return { ok: true, output: `${org}/${repoSlug} already born — ${dir}` };
  await say(`▓ pre-birthing ${org}/${repoSlug}`);
  scaffoldDay(dir, join(dir, "ψ"), repoSlug, fileSlug);
  await commitPushDay(dir, org, repoSlug, `day: ${fileSlug} — born ahead of its day`, say);
  await say(`▓ ${dir}`);
  return { ok: true, output: buf2.length ? buf2.join("\n") : undefined };
}
