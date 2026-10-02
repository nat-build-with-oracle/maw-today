import { join } from "node:path";
import { run } from "./types";

export async function sweepOracle(repo: string, execute = run) {
  const warnings: string[] = [], blockingErrors: string[] = [];
  const result = { repo, status: "", verify: "", statusCheck: "unknown", verifyCheck: "unknown", warnings, blockingErrors };
  const cwd = join(repo, "ψ/teams");
  let recipes: Set<string>;
  try { recipes = new Set(String((await execute("just", ["--summary"], { cwd, timeout: 30000 })).stdout).trim().split(/\s+/)); }
  catch (e: any) { blockingErrors.push(`${repo}: just --summary: ${e.message}`); return result; }
  for (const verb of ["status", "verify"] as const) {
    const check = verb === "status" ? "statusCheck" : "verifyCheck";
    if (!recipes.has(verb)) {
      result[check] = `${verb}: n/a (no recipe)`;
      warnings.push(`${repo}: ${result[check]}`);
      continue;
    }
    try {
      result[verb] = String((await execute("just", [verb], { cwd, timeout: 30000, maxBuffer: 4 << 20 })).stdout);
      result[check] = `${verb}: ok`;
    } catch (e: any) {
      result[check] = `${verb}: failed`;
      blockingErrors.push(`${repo}: just ${verb}: ${e.message}`);
      result[verb] = String(e.stdout || "");
    }
  }
  return result;
}
