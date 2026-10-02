/** Fleet owners for the upstream search. Owner-scoped is LOAD-BEARING: `--involves`
 *  misses every bot/oracle-authored PR — probed 2026-09-01: owner-scoped on just 2 of
 *  6 orgs found MORE rows (11) than --involves across all of GitHub (9). All owners fit
 *  ONE query: GitHub's documented 5-clause cap is boolean operators, not repeated
 *  owner qualifiers (6 tested clean). */
export const ghOwners = () => {
  // `||` not `??`: an EMPTY env var must fall back too — with ?? it would strip every
  // --owner flag and silently search all of GitHub, rendering strangers' PRs as the
  // fleet's day. Same guard on a whitespace-only value.
  const list = (process.env.MAW_TODAY_OWNERS || "laris-co,Soul-Brews-Studio,nat-build-with-oracle,DustBoy-PM25,FloodBoy-CM,nazt")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("MAW_TODAY_OWNERS is set but holds no owner — an ownerless search is all of GitHub");
  return list;
};
