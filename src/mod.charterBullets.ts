export function charterBullets(readme: string): string[] {
  const section = /^## Charter-lite\s*\r?\n([\s\S]*?)(?=^##? |$(?![\s\S]))/m.exec(readme)?.[1] ?? "";
  return section.split("\n").filter(l => /^- \*\*(Done-when|Escalate)\*\*:/.test(l));
}
