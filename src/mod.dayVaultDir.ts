import { join } from "node:path";
import { dayRepoSlug } from "./mod.dayRepoSlug";

/** The day's own vault: ghq/github.com/<org>/<slug>/ψ. The DAY REPO is the vault
 *  (Nat, 2026-09-01, superseding the psi-link destination): every digest lives with
 *  the day it describes, not in any host oracle's memory. */
export function dayVaultDir(): string {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const ghqRoot = execFileSync("ghq", ["root"], { encoding: "utf8" }).trim();
  const org = process.env.MAW_TODAY_ORG || "nat-build-with-oracle";
  return join(ghqRoot, "github.com", org, dayRepoSlug(), "ψ");
}
