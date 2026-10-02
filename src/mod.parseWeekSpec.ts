import { isoWeek } from "./mod.isoWeek";
import { isoWeekStart } from "./mod.isoWeekStart";

/** Which week `maw week` shows: none = this week; `39` = week 39 of this ISO year (or of
 *  --year); `2025W40` / `2025-W40` names both. Throws with the fix on a week that does
 *  not exist, never silently shows another. */
export function parseWeekSpec(spec?: string, year?: string, now = new Date()): { start: Date; end: Date; tag: string } {
  const cur = isoWeek(now);
  let y = Number(cur.slice(0, 4)), w = Number(cur.slice(5));
  if (year !== undefined) {
    if (!/^\d{4}$/.test(year)) throw new Error(`--year needs four digits, got "${year}"\n  maw week ${w} --year ${y}`);
    y = Number(year);
  }
  if (spec !== undefined) {
    const m = /^(?:(\d{4})-?[wW])?(\d{1,2})$/.exec(spec);
    if (!m) throw new Error(`cannot read week "${spec}" — use a number or YYYYWnn\n  maw week ${w}\n  maw week ${y}W${String(w).padStart(2, "0")}`);
    if (m[1]) y = Number(m[1]);
    w = Number(m[2]);
  }
  const last = Number(isoWeek(new Date(y, 11, 28)).slice(5));   // 28 Dec is always in the year's last week
  if (w < 1 || w > last) throw new Error(`${y} has weeks 1–${last}; there is no week ${w}\n  maw week ${last} --year ${y}`);
  const start = isoWeekStart(y, w);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { start, end, tag: `${y}W${String(w).padStart(2, "0")}` };
}
