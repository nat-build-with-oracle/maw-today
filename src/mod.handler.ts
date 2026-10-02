import { WEEK_VERBS, type InvokeContext, type InvokeResult } from "./types";
import { asArgs } from "./mod.asArgs";
import { cmdDigest } from "./mod.cmdDigest";
import { cmdIdea } from "./mod.cmdIdea";
import { cmdLs } from "./mod.cmdLs";
import { cmdTomorrow } from "./mod.cmdTomorrow";
import { cmdTui } from "./mod.cmdTui";
import { cmdWindow } from "./mod.cmdWindow";
import { splitWeek } from "./mod.splitWeek";
import { syncDayRepo } from "./mod.syncDayRepo";
import { wrapup } from "./mod.wrapup";

export async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const { week, args } = splitWeek(asArgs(ctx.args), ctx.matchedName ?? process.env.MAW_MATCHED_NAME);
  const name = week ? "week" : "today";
  // Pull the week selector out before the verb is looked for: `maw week 39 commits`
  // would otherwise read "39" as the verb, and `--year 2025` would make 2025 one.
  let weekSpec: string | undefined, yearSpec: string | undefined;
  if (week) {
    const yi = args.indexOf("--year");
    if (yi >= 0) { yearSpec = args[yi + 1] ?? ""; args.splice(yi, 2); }
    const si = args.findIndex((a) => /^(\d{4}-?[wW])?\d{1,2}$/.test(a));
    if (si >= 0) { weekSpec = args[si]; args.splice(si, 1); }
  }
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const json = args.includes("--json");
  // Default is the FIRST SECTION only (Nat, 2026-09-01): sessions are instant, while
  // the commit scan costs seconds and a screenful. The long nested listing lives under
  // its own verb; plain `maw today` answers at a glance.
  const verb = args.find((a) => !a.startsWith("--") && !["1d", "3d"].includes(a));
  const sub = verb ?? "sessions";
  // Bare `maw today` (no verb) shows the sessions glance, THEN auto-syncs the day repo
  // (Nat, 2026-09-01: "the output of maw today should show this first … then auto append").
  // An explicit `maw today sessions|commits|all` must NOT write — a read verb stays a read.
  // `maw week` never writes: there is no week repo, and the day repo is today's.
  const isDefault = verb === undefined && !json && !week;
  if (week && !WEEK_VERBS.has(sub))
    return { ok: false, error: `maw week reads a window; "${sub}" is not a week view (sessions, commits, gh, all).\n  maw today ${args.join(" ")}\n  maw week all` };

  if (sub === "wrapup") return wrapup(args.includes("--dry-run"), json);

  if (sub === "tui") return cmdTui();

  // The day as a PRIVATE repo — see syncDayRepo. `new` and `repo` are the strict doors
  // (Nat, 2026-09-01): `new` the deliberate birth, `repo` the update. The bare
  // `maw today` runs the same body in `auto` mode after the sessions view (below).
  if (sub === "new" || sub === "repo") return syncDayRepo(ctx, sub, flag("since"));

  if (sub === "tomorrow") return cmdTomorrow(ctx, flag);

  if (sub === "idea") return cmdIdea(ctx, args, flag);

  if (sub === "ls") return cmdLs(flag, json);

  if (sub === "digest") return cmdDigest(flag);

  if (!["all", "commits", "sessions", "gh"].includes(sub)) {
    return { ok: false, error: `unknown subcommand "${sub}" — use commits, sessions, gh, digest, ls, wrapup, tomorrow, idea, new, repo, tui, or all` };
  }

  return cmdWindow({ ctx, flag, json, sub, name, week, weekSpec, yearSpec, isDefault });
}
