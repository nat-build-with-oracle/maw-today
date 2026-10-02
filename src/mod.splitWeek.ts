/** Split off the week mode. `maw week` is this plugin under its alias (Nat, 2026-10-02):
 *  the host names the typed verb in ctx.matchedName (MAW_MATCHED_NAME for a host that
 *  only sets the env). `maw today week` reaches the same view on a host that passes
 *  neither, and `maw week today` is plain `maw today` — writes and all. */
export function splitWeek(args: string[], typedName?: string): { week: boolean; args: string[] } {
  let week = typedName === "week";
  if (args[0] === "week") { week = true; args = args.slice(1); }
  if (week && args[0] === "today") return { week: false, args: args.slice(1) };
  return { week, args };
}
