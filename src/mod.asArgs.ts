export const asArgs = (a: unknown): string[] =>
  Array.isArray(a) ? a.map(String) : typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [];
