/** Local Monday 00:00 of the week holding `d` — "this week" is a calendar word, as
 *  "today" is: on Friday nobody means "the last seven days from Friday noon". */
export function weekStart(d = new Date()): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
