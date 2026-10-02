import { type InvokeResult, type Flag } from "./types";
import { ghToday } from "./mod.ghToday";
import { gitToday } from "./mod.gitToday";
import { resolveSince } from "./mod.resolveSince";
import { sessionsToday } from "./mod.sessionsToday";
import { since0 } from "./mod.since0";
import { writeDigest } from "./mod.writeDigest";

export async function cmdDigest(flag: Flag): Promise<InvokeResult> {
  const winAt = since0(flag("since"));   // once — see syncDayRepo
  const [commits, sessions, gh] = await Promise.all([
    gitToday(winAt), sessionsToday(winAt), ghToday(winAt).catch(() => null),
  ]);
  try {
    const f = writeDigest(commits, sessions, resolveSince(flag("since")).label, undefined, gh, winAt);
    return { ok: true, output: `${commits.length} commits · ${sessions.length} sessions\ndigest → ${f}` };
  } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
