import { type GhItem } from "./types";

export const ghCounts = (gh: GhItem[]) => ({
  opened: gh.filter((g) => g.kind === "pr-opened").length,
  merged: gh.filter((g) => g.kind === "pr-merged").length,
  closed: gh.filter((g) => g.kind === "issue-closed").length,
});
