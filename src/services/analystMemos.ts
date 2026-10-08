// Memos written by the /underwriting-analyst skill to docs/memos/<property id>.md.
// Each memo is its own lazy chunk, loaded only when the Analyst memo tab opens.
const MEMOS = import.meta.glob<string>('/docs/memos/*.md', { query: '?raw', import: 'default' })

const memoPath = (propertyId: string) => `/docs/memos/${propertyId}.md`

/** The memo's Markdown, or null when none has been written for this property. */
export function loadAnalystMemo(propertyId: string): Promise<string | null> {
  const load = MEMOS[memoPath(propertyId)]
  return load ? load() : Promise.resolve(null)
}

/** The memo's as-of date (YYYY-MM-DD) from its "As of …" line: the day the skill ran the engine. */
export function memoDate(markdown: string): string | null {
  return /^As of (\d{4}-\d{2}-\d{2})\b/m.exec(markdown)?.[1] ?? null
}
