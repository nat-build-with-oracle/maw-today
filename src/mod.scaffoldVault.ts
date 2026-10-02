import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_DIRS } from "./types";

export function scaffoldVault(vault: string, extra: string[] = []) {
  for (const d of [...VAULT_DIRS, ...extra]) mkdirSync(join(vault, d), { recursive: true });
  for (const d of VAULT_DIRS) writeFileSync(join(vault, d, ".gitkeep"), "");
}
