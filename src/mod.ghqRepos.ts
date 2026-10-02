import { run } from "./types";

export async function ghqRepos(): Promise<string[]> {
  try {
    const { stdout } = await run("ghq", ["list", "-p"], { maxBuffer: 32 << 20 });
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
