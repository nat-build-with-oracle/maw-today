import { daySlug } from "./mod.daySlug";

/** The day's REPO name — an oracle: "1sep-tue2026-oracle" (Nat, 2026-09-01). daySlug
 *  names the digest FILE inside; this names the repo/dir/remote that carries it. The
 *  year is present here (unlike daySlug) so repo names never collide across years, and
 *  the `-oracle` suffix marks it a member of the fleet, not a stray dated folder. */
export function dayRepoSlug(d = new Date()): string {
  return `${daySlug(d)}${d.getFullYear()}-oracle`;
}
