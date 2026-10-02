export const cell = (v: unknown) => String(v ?? "unknown").replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
