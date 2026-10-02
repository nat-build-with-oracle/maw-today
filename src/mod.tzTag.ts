/** "+07" style offset tag, derived — hardcoding it would lie on every other machine. */
export const tzTag = (d = new Date()) => {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? "+" : "-";
  return `${sign}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}${Math.abs(m) % 60 ? ":" + String(Math.abs(m) % 60).padStart(2, "0") : ""}`;
};
