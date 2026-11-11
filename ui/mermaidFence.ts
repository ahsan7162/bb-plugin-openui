/** A fence longer than any backtick run in the source keeps it one block. */
export function mermaidFence(source: string): string {
  const longestRun = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}mermaid\n${source}\n${fence}`;
}
