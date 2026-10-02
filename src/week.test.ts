import { expect, test } from "bun:test";
import { isoWeek, parseWeekSpec, splitWeek, weekStart } from "./index";

test("weekStart is local Monday midnight, Monday itself included", () => {
  expect(weekStart(new Date(2026, 9, 2, 12, 9))).toEqual(new Date(2026, 8, 28));   // Fri → Mon 28 Sep
  expect(weekStart(new Date(2026, 8, 28, 0, 0))).toEqual(new Date(2026, 8, 28));   // Mon 00:00 stays
  expect(weekStart(new Date(2026, 9, 4, 23, 59))).toEqual(new Date(2026, 8, 28));  // Sun still that week
});

test("isoWeek follows the Thursday rule across year ends", () => {
  expect(isoWeek(new Date(2026, 9, 2))).toBe("2026W40");
  expect(isoWeek(new Date(2026, 0, 1))).toBe("2026W01");   // Thu 1 Jan 2026
  expect(isoWeek(new Date(2027, 0, 1))).toBe("2026W53");   // Fri 1 Jan 2027 belongs to 2026
  expect(isoWeek(new Date(2024, 11, 30))).toBe("2025W01"); // Mon 30 Dec 2024
});

test("splitWeek: alias, verb form, and week today", () => {
  expect(splitWeek([], "week")).toEqual({ week: true, args: [] });
  expect(splitWeek(["commits"], "week")).toEqual({ week: true, args: ["commits"] });
  expect(splitWeek(["today"], "week")).toEqual({ week: false, args: [] });
  expect(splitWeek(["today", "all"], "week")).toEqual({ week: false, args: ["all"] });
  expect(splitWeek(["week", "gh"], "today")).toEqual({ week: true, args: ["gh"] });
  expect(splitWeek([], "today")).toEqual({ week: false, args: [] });
  expect(splitWeek([], "td")).toEqual({ week: false, args: [] });
  expect(splitWeek(["today"], "today")).toEqual({ week: false, args: ["today"] }); // not week: left alone
});

test("parseWeekSpec: number, YYYYWnn, --year, and weeks that do not exist", () => {
  const now = new Date(2026, 9, 2, 12);
  expect(parseWeekSpec(undefined, undefined, now).tag).toBe("2026W40");
  const w39 = parseWeekSpec("39", undefined, now);
  expect([w39.tag, w39.start, w39.end]).toEqual(["2026W39", new Date(2026, 8, 21), new Date(2026, 8, 28)]);
  expect(parseWeekSpec("2025W40", undefined, now).start).toEqual(new Date(2025, 8, 29));
  expect(parseWeekSpec("2025-w40", undefined, now).tag).toBe("2025W40");
  expect(parseWeekSpec("40", "2025", now).tag).toBe("2025W40");
  expect(parseWeekSpec("53", "2026", now).start).toEqual(new Date(2026, 11, 28));
  expect(() => parseWeekSpec("54", "2026", now)).toThrow("maw week 53 --year 2026");
  expect(() => parseWeekSpec("53", "2025", now)).toThrow("2025 has weeks 1–52");
  expect(() => parseWeekSpec(undefined, "25", now)).toThrow("--year needs four digits");
});
