import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdown'

describe('parseInline', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ])
  })
  it('nests italic inside bold', () => {
    expect(parseInline('**a *b***')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'a ' }, { type: 'em', children: [{ type: 'text', text: 'b' }] }] },
    ])
  })
  it('leaves unmatched markers and escapes as text', () => {
    expect(parseInline('5 * 3 and **open')).toEqual([{ type: 'text', text: '5 * 3 and **open' }])
    expect(parseInline('\\*not em\\*')).toEqual([{ type: 'text', text: '*not em*' }])
  })
  it('keeps code literal', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }])
  })
})

describe('parseMarkdown', () => {
  it('parses headings, paragraphs and rules', () => {
    const blocks = parseMarkdown('# Title\n\nline one\nline two\n\n---\n## Sub')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'rule', 'heading'])
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'line one line two' }] })
    expect(blocks[3]).toMatchObject({ type: 'heading', level: 2 })
  })
  it('parses bullet and numbered lists, with continuation lines', () => {
    const [ul, ol] = parseMarkdown('- a\n- b\n  more\n\n3. x\n4. y')
    expect(ul).toMatchObject({ type: 'list', ordered: false, items: [[{ text: 'a' }], [{ text: 'b more' }]] })
    expect(ol).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })
  it('does not treat an italic line as a bullet', () => {
    expect(parseMarkdown('*AI-generated analysis.*')[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'em' }] })
  })
  it('parses tables with alignment, empty header cells and escaped pipes', () => {
    const [t] = parseMarkdown('| | |\n|---|--:|\n| a \\| b | **1** |\n| short |')
    expect(t).toMatchObject({ type: 'table', align: [null, 'right'] })
    if (t.type !== 'table') throw new Error()
    expect(t.header).toEqual([[], []])
    expect(t.rows[0][0]).toEqual([{ type: 'text', text: 'a | b' }])
    expect(t.rows[0][1]).toEqual([{ type: 'strong', children: [{ type: 'text', text: '1' }] }])
    expect(t.rows[1]).toEqual([[{ type: 'text', text: 'short' }], []])
  })
  it('needs a divider row to make a table', () => {
    expect(parseMarkdown('| a |\n| b |')[0].type).toBe('paragraph')
  })
})
