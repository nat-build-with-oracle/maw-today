import { run } from "./types";

/** Commit whatever changed in a day repo and push, creating the PRIVATE remote on
 *  first contact. PRIVATE is load-bearing: digests and plans name private repos. */
export async function commitPushDay(dir: string, org: string, repoSlug: string, subject: string,
                             say: (l: string) => Promise<void>) {
  const git = (...a: string[]) => run("git", ["-C", dir, ...a]);
  try { await git("rev-parse", "--git-dir"); } catch { await git("init", "-q"); }
  await git("add", "-A");
  const staged = await git("diff", "--cached", "--quiet").then(() => false).catch(() => true);
  if (staged) {
    await git("commit", "-q", "-m",
      `${subject}\n\nWritten by maw today.\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`);
    await say(`▓ committed`);
  } else await say(`▓ nothing new to commit`);
  const remote = await run("gh", ["repo", "view", `${org}/${repoSlug}`, "--json", "name"]).then(() => true).catch(() => false);
  if (!remote) {
    await run("gh", ["repo", "create", `${org}/${repoSlug}`, "--private", "--source", dir, "--push"]);
    await say(`▓ created PRIVATE github.com/${org}/${repoSlug} and pushed`);
  } else if (staged) {
    await git("push", "-u", "origin", "HEAD");
    await say(`▓ pushed`);
  }
}
