import { expect, test } from "bun:test";
import { isoWeek, splitWeek, weekStart } from "./index";

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
