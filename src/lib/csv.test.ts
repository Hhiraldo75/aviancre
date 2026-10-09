import { describe, expect, it } from 'vitest'
import { parseCSV } from './csv'

describe('parseCSV', () => {
  it('splits rows and cells, keeping empty cells', () => {
    expect(parseCSV('a,b,c\n1,,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })
  it('keeps blank lines as one empty cell', () => {
    expect(parseCSV('a\n\nb')).toEqual([['a'], [''], ['b']])
  })
  it('handles quotes, escaped quotes, commas and line breaks inside quotes', () => {
    expect(parseCSV('"Smith, Jones","say ""hi""","two\nlines"\n')).toEqual([['Smith, Jones', 'say "hi"', 'two\nlines']])
  })
  it('handles CRLF line endings and a byte-order mark', () => {
    expect(parseCSV('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
