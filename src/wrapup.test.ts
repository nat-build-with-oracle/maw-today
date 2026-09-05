import { expect, test } from "bun:test";
import { parseWorkers, workersTable } from "./index";

test("main body without branch is unknown, not zero", () => {
  const [r] = parseWorkers("oracle", "  01-lab [main] WORKING Context 43% left", "── 01-lab ──\n  (no branch — main-checkout worker; check the main tree's own status)");
  expect(r).toMatchObject({ worker: "01-lab", state: "WORKING", contextLeft: 43, ahead: null, cwdCheck: "unknown" });
});
test("verify counts hash lines only, including empty merged branch", () => {
  const rows = parseWorkers("o", "01-lab [wt] idle\n02-lab [wt] WORKING\n── quota ──", "── 01-lab ──\n abc1234 first\n 0123456 second\n── 02-lab ──\n");
  expect(rows.map(r => r.ahead)).toEqual([2, 0]);
  expect(rows[0].contextLeft).toBeNull();
});
test("missing verify is unknown; prose cannot fabricate workers", () => {
  expect(parseWorkers("o", "01-lab [wt] idle", "")[0].ahead).toBeNull();
  expect(parseWorkers("o", "(no session)\n agents/old — worktree with no worker window", "")).toEqual([]);
});
test("screen pipes and newlines cannot corrupt markdown rows", () => {
  const [r] = parseWorkers("o", "01-lab [main] idle", "");
  r.lastLine = "one|two\nthree";
  expect(workersTable([r])).toContain("one\\|two three");
});
