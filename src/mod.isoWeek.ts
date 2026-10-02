/** "2026W40" — ISO week-numbering year and week (the week holding Thursday decides),
 *  the same tag relic v3 names its week partitions with. */
export function isoWeek(d = new Date()): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const jan4 = new Date(t.getFullYear(), 0, 4);
  const wk = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400e3 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}W${String(wk).padStart(2, "0")}`;
}
