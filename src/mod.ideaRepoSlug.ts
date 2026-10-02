import { daySlug } from "./mod.daySlug";

/** The idea's REPO name — "idea-7sep-mon2026-<slug>" (Nat, 2026-09-07, revised the same
 *  morning from idea-7sep-<slug>): the date part is EXACTLY the day repo's
 *  (7sep-mon2026-oracle minus -oracle), so an idea sorts next to its day in the org and
 *  the year keeps names from colliding across years, as dayRepoSlug's does. */
export function ideaRepoSlug(slug: string, d = new Date()): string {
  return `idea-${daySlug(d)}${d.getFullYear()}-${slug}`;
}
