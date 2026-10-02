/** "1sep-tue" — daymonth-weekday, lowercase, local TZ. Nat's format (2026-09-01,
 *  revised same day from 1-sep-tue-2026). NOTE the accepted trade: without a year the
 *  slug recurs when the same date falls on the same weekday again (~5-11 years), and a
 *  day-repo of that name will already exist. Deliberate; flip by appending
 *  `-${d.getFullYear()}` here if that day ever comes. */
export function daySlug(d = new Date()): string {
  return `${d.getDate()}${d.toLocaleString("en", { month: "short" }).toLowerCase()}-` +
         d.toLocaleString("en", { weekday: "short" }).toLowerCase();
}
