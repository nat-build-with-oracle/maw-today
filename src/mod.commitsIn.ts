import { run, type Commit } from "./types";

export async function commitsIn(repo: string, since: number, strict = false, until?: number): Promise<Commit[]> {
  try {
    // %x1f is a unit separator: subjects contain every other delimiter you might pick.
    const { stdout } = await run(
      "git",
      ["-C", repo, "log", "--all", "--no-merges", `--since=${new Date(since).toISOString()}`,
       ...(until ? [`--until=${new Date(until).toISOString()}`] : []),
       "--pretty=format:%H%x1f%ct%x1f%an%x1f%s"],
      { maxBuffer: 8 << 20 },
    );
    return stdout.split("\n").filter(Boolean).map((line) => {
      const [hash, at, author, subject] = line.split("\x1f");
      return { repo, hash: hash.slice(0, 7), at: Number(at) * 1000, author, subject };
    });
  } catch (e) {
    if (strict) throw e;
    return [];
  }
}
