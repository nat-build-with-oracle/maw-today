/**
 * Resolve --since to an epoch ms. Bare `1d`/`3d`/`2h` are relative; an ISO date is
 * absolute. Default is LOCAL midnight, not 24h ago — "today" is a calendar word, and
 * at 09:00 nobody means "since 09:00 yesterday".
 */
export function resolveSince(spec?: string): { at: number; label: string } {
  if (!spec) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { at: d.getTime(), label: "today" };
  }
  const rel = /^(\d+)([dhm])$/.exec(spec);
  if (rel) {
    const n = Number(rel[1]);
    const mult = rel[2] === "d" ? 86400e3 : rel[2] === "h" ? 3600e3 : 60e3;
    return { at: Date.now() - n * mult, label: `last ${spec}` };
  }
  // A bare date must mean LOCAL midnight: Date.parse("2026-09-01") is UTC midnight per
  // ECMAScript, which in +07 starts the window at 07:00 and silently drops the first
  // seven hours of the requested calendar day — while the label claims the full day.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec);
  if (ymd) return { at: new Date(+ymd[1], +ymd[2] - 1, +ymd[3]).getTime(), label: `since ${spec}` };
  const t = Date.parse(spec);
  if (!Number.isNaN(t)) return { at: t, label: `since ${spec}` };
  // An unparseable --since must not silently become "today" — that would report a
  // window the caller did not ask for and looks identical to success.
  throw new Error(`cannot parse --since "${spec}" — use 1d, 3h, or YYYY-MM-DD`);
}
