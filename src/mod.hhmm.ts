// A time before local midnight carries its weekday ("Tue 14:05"): over a week, or
// --since 3d, a bare 14:05 does not say which day it was.
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  return ms < midnight.getTime() ? `${d.toLocaleString("en", { weekday: "short" })} ${t}` : t;
};
