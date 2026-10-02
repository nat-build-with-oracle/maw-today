/** Local Monday 00:00 of ISO week `w` of ISO year `y` (week 1 holds 4 January). */
export function isoWeekStart(y: number, w: number): Date {
  const jan4 = new Date(y, 0, 4);
  return new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
}
