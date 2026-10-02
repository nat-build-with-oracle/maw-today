/** Rows bucketed by the LOCAL calendar day of `at`, in first-seen order — the input is
 *  already time-sorted, so the days come out oldest first. `label` reads "Mon 28sep",
 *  with "· today" on today's bucket; `start` is that day's local midnight, which
 *  clockOn compares against. */
export function groupByDay<T>(rows: T[], at: (row: T) => number): { label: string; start: number; rows: T[] }[] {
  const days = new Map<number, { label: string; start: number; rows: T[] }>();
  const today = new Date().setHours(0, 0, 0, 0);
  for (const row of rows) {
    const d = new Date(at(row));
    const start = new Date(d).setHours(0, 0, 0, 0);
    let day = days.get(start);
    if (!day) {
      const label = `${d.toLocaleString("en", { weekday: "short" })} ${d.getDate()}${d.toLocaleString("en", { month: "short" }).toLowerCase()}` +
        (start === today ? " · today" : "");
      day = { label, start, rows: [] };
      days.set(start, day);
    }
    day.rows.push(row);
  }
  return [...days.values()];
}
