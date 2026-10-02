import { type WorkerRow } from "./types";
import { cell } from "./mod.cell";

export function workersTable(rows: WorkerRow[]): string {
  return ["| oracle | worker | body | state | context % left | ahead of main | cwd check | last screen line |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${[r.oracle, r.worker, r.body, r.state, r.contextLeft, r.ahead, r.cwdCheck, r.lastLine].map(cell).join(" | ")} |`)].join("\n");
}
