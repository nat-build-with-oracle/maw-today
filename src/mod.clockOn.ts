import { hhmm } from "./mod.hhmm";

/** A time printed under a day header: bare "14:05" when it falls on that day, and the
 *  weekday form ("Wed 08:35") when it does not — the 👤 column often points at an
 *  earlier day than the row's last write. */
export function clockOn(ms: number, dayStart: number): string {
  if (new Date(ms).setHours(0, 0, 0, 0) !== dayStart) return hhmm(ms);
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
