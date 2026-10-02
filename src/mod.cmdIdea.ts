import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { run, type InvokeContext, type InvokeResult, type Flag } from "./types";
import { commitPushDay } from "./mod.commitPushDay";
import { dayRepoSlug } from "./mod.dayRepoSlug";
import { daySlug } from "./mod.daySlug";
import { hhmmLocal } from "./mod.hhmmLocal";
import { ideaRepoSlug } from "./mod.ideaRepoSlug";
import { ideaSlug } from "./mod.ideaSlug";
import { scaffoldDay } from "./mod.scaffoldDay";
import { scaffoldIdea } from "./mod.scaffoldIdea";
import { tzTag } from "./mod.tzTag";

// IDEA — an idea capsule born from today (Nat, 2026-09-07: "idea-7sep-mon2026-xxxxx"). The
// SAME birth as a day: the /awaken vault, a PRIVATE repo under the org, commit + push
// on first contact — but named for the thought, not the date, and linked BOTH ways:
// the idea's CLAUDE.md names the day it came from, and the day's ψ/outbox/ideas/<slug>.md
// names the idea (the digest lists that folder). A day remembers what it left; an idea
// remembers where it started. The homelab MOVED.md two-way link, applied at birth.
export async function cmdIdea(ctx: InvokeContext, args: string[], flag: Flag): Promise<InvokeResult> {
  const buf3: string[] = [];
  const say = async (l: string) => { if (ctx.writer) await ctx.writer(l); else buf3.push(l); };
  // Title = every word after `idea` that is not a flag or a flag's value. Quotes do not
  // survive maw's whitespace split, so the words are joined back with single spaces.
  const rest = args.slice(args.indexOf("idea") + 1);
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) { if (rest[i] !== "--json") i++; continue; }
    words.push(rest[i]);
  }
  const title = words.join(" ").trim() || flag("slug") || "";
  // GitHub repo names are ASCII — a Thai title slugs to nothing, so --slug names the
  // repo while the title keeps the Thai. Neither is guessed from the other.
  const slug = ideaSlug(flag("slug") ?? title);
  if (!title) return { ok: false, error: "maw today idea <title> [--slug name] — an idea needs a title" };
  if (!slug) return { ok: false, error: `"${title}" has no ASCII letters for a repo name — add --slug <name>` };
  const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
  let ghqRoot = "";
  try { ghqRoot = (await run("ghq", ["root"])).stdout.trim(); }
  catch { return { ok: false, error: "ghq not available — cannot place the idea repo" }; }
  const repoSlug = ideaRepoSlug(slug);
  const dir = join(ghqRoot, "github.com", org, repoSlug);
  if (existsSync(join(dir, "CLAUDE.md")))
    return { ok: true, output: `${org}/${repoSlug} already born — ${dir}` };
  const dayRepo = dayRepoSlug(), dayFile = daySlug();
  const dayDir = join(ghqRoot, "github.com", org, dayRepo);
  const born = `${hhmmLocal(Date.now())} ${tzTag()}`;

  await say(`▓ idea — ${org}/${repoSlug}`);
  scaffoldIdea(dir, repoSlug, title, born, `${org}/${dayRepo}`);
  await commitPushDay(dir, org, repoSlug, `idea: ${title} — born ${dayFile}`, say);

  // The day's half of the link. A day not yet born gets the same pre-birth `tomorrow`
  // gives — an idea is a fine first thing for a day to hold; bare `maw today` refreshes it.
  if (!existsSync(join(dayDir, "CLAUDE.md"))) {
    await say(`▓ day not born yet — scaffolding ${org}/${dayRepo}`);
    scaffoldDay(dayDir, join(dayDir, "ψ"), dayRepo, dayFile);
  }
  const ideasDir = join(dayDir, "ψ", "outbox", "ideas");
  mkdirSync(ideasDir, { recursive: true });
  writeFileSync(join(ideasDir, `${slug}.md`),
    `# ${title}\n\n- born: ${born}\n- repo: ${org}/${repoSlug}\n- dir: ${dir}\n`);
  await say(`▓ linked from ${dayRepo} → ψ/outbox/ideas/${slug}.md`);
  await commitPushDay(dayDir, org, dayRepo, `day: ${dayFile} — idea ${slug}`, say);
  await say(`▓ ${dir}`);
  return { ok: true, output: buf3.length ? buf3.join("\n") : undefined };
}
