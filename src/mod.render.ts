import { type Commit, type Session } from "./types";
import { bytes } from "./mod.bytes";
import { hhmm } from "./mod.hhmm";
import { short } from "./mod.short";

export function render(label: string, commits: Commit[] | null, sessions: Session[] | null): string {
  const L: string[] = [];
  L.push(`maw today — ${label}`);

  if (commits) {
    L.push("");
    if (!commits.length) {
      L.push("commits   none");
    } else {
      const repos = new Set(commits.map((c) => c.repo));
      L.push(`commits   ${commits.length} across ${repos.size} repo${repos.size === 1 ? "" : "s"}`);
      for (const c of commits) {
        L.push(`  ${hhmm(c.at)}  ${c.hash}  ${short(c.repo).padEnd(28)} ${c.subject.slice(0, 72)}`);
      }
    }
  }

  if (sessions) {
    L.push("");
    if (!sessions.length) {
      L.push("sessions  none");
    } else {
      const projects = new Set(sessions.map((s) => s.project));
      L.push(`sessions  ${sessions.length} across ${projects.size} project${projects.size === 1 ? "" : "s"}`);
      for (const s of sessions) {
        L.push(`  ${hhmm(s.at)}  ${s.id}  ${short(s.project).padEnd(28)} ${bytes(s.bytes)}`);
      }
    }
  }
  return L.join("\n");
}
