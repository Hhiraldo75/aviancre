/**
 * Minimal Markdown parser for analyst memos: headings, paragraphs, lists, tables, rules,
 * and inline bold / italic / code. No HTML passthrough; the result renders as React elements.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; align: ('left' | 'right' | 'center' | null)[]; rows: Inline[][][] }
  | { type: 'rule' }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DIVIDER = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/

/** Splits a table row on unescaped pipes, dropping the outer ones. */
function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  out.push(cur.trim())
  return out
}

function alignOf(cell: string): 'left' | 'right' | 'center' | null {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

/** Index of the closing marker for an opening one at `from`, or -1. A single `*` never closes on `**`. */
function closing(s: string, marker: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (!s.startsWith(marker, i)) continue
    if (marker === '*' && (s[i + 1] === '*' || s[i - 1] === '*')) continue
    // In a run like `***`, bold closes last so a nested italic can close first.
    if (marker === '**' && s[i + 2] === '*') i++
    if (i > from) return i
  }
  return -1
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  for (let i = 0; i < s.length; ) {
    if (s[i] === '\\' && i + 1 < s.length && /[\\`*_|]/.test(s[i + 1])) {
      text += s[i + 1]
      i += 2
      continue
    }
    const marker = s[i] === '`' ? '`' : s.startsWith('**', i) ? '**' : s[i] === '*' ? '*' : null
    const end = marker ? closing(s, marker, i + marker.length) : -1
    if (!marker || end < 0) {
      text += s[i]
      i++
      continue
    }
    flush()
    const inner = s.slice(i + marker.length, end)
    if (marker === '`') out.push({ type: 'code', text: inner })
    else out.push({ type: marker === '**' ? 'strong' : 'em', children: parseInline(inner) })
    i = end + marker.length
  }
  flush()
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: { ordered: boolean; start: number; items: string[] } | null = null

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, start: list.start, items: list.items.map(parseInline) })
    list = null
  }
  const flush = () => {
    flushPara()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      flush()
      continue
    }
    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      flush()
      const header = cells(line)
      const align = cells(lines[i + 1]).map(alignOf)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const row = cells(lines[i])
        rows.push(header.map((_, c) => parseInline(row[c] ?? '')))
        i++
      }
      i--
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) })
      continue
    }
    if (RULE.test(line)) {
      flush()
      blocks.push({ type: 'rule' })
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = bullet ? null : ORDERED.exec(line)
    if (bullet || ordered) {
      flushPara()
      const isOrdered = !!ordered
      if (list && list.ordered !== isOrdered) flushList()
      list ??= { ordered: isOrdered, start: ordered ? Number(ordered[1]) : 1, items: [] }
      list.items.push(bullet ? bullet[1] : ordered![2])
      continue
    }
    // An indented line under a list item continues that item.
    if (list && /^\s+/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim()
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flush()
  return blocks
}
