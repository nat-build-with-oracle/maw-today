import { expect, test } from "bun:test";
import { clockOn } from "./mod.clockOn";
import { groupByDay } from "./mod.groupByDay";

test("groupByDay buckets by local day, oldest first, counts rows", () => {
  const at = (d: number, h: number) => new Date(2026, 8, d, h, 5).getTime();
  const days = groupByDay([at(28, 4), at(28, 20), at(30, 14), at(1 + 30, 3)], (x) => x);
  expect(days.map((d) => [d.label, d.rows.length])).toEqual([["Mon 28sep", 2], ["Wed 30sep", 1], ["Thu 1oct", 1]]);
  expect(days[0].start).toBe(new Date(2026, 8, 28).getTime());
});

test("clockOn: bare clock on the header's day, weekday form otherwise", () => {
  const thu = new Date(2026, 9, 1).getTime();
  expect(clockOn(new Date(2026, 9, 1, 18, 42).getTime(), thu)).toBe("18:42");
  expect(clockOn(new Date(2026, 8, 30, 8, 35).getTime(), thu)).toBe("Wed 08:35");
});
