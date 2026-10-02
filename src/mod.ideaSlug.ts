/** A repo-safe slug from an idea title: GitHub repo names are ASCII letters, digits,
 *  `-` — so accents fold (café → cafe) and everything else becomes a hyphen. A Thai
 *  title slugs to "" on purpose; the caller asks for --slug rather than inventing one. */
export function ideaSlug(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
}
