import { describe, expect, it } from 'vitest'
import { nullSafeFilter } from './styleFilters'

describe('nullSafeFilter', () => {
  it('reads a numeric property with a fallback that fails the comparison', () => {
    expect(nullSafeFilter(['all', ['<=', ['get', 'ref_length'], 6], ['==', ['get', 'class'], 'x']])).toEqual([
      'all',
      ['<=', ['number', ['get', 'ref_length'], 1e9], 6],
      ['==', ['get', 'class'], 'x'],
    ])
    expect(nullSafeFilter(['>=', ['get', 'rank'], 3])).toEqual(['>=', ['number', ['get', 'rank'], -1e9], 3])
  })

  it('leaves filters without an ordered comparison alone', () => {
    expect(nullSafeFilter(['==', ['get', 'class'], 'path'])).toBeNull()
    expect(nullSafeFilter(undefined)).toBeNull()
  })
})
