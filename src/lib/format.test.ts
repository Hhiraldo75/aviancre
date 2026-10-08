import { describe, expect, it } from 'vitest'
import { fmt } from './format'

describe('percent formatting', () => {
  it('puts negative percentages in parentheses', () => {
    expect(fmt.pct(0.065)).toBe('6.5%')
    expect(fmt.pct(-0.021)).toBe('(2.1%)')
    expect(fmt.pct(-0.0725, 2)).toBe('(7.25%)')
    expect(fmt.pctShort(-0.02)).toBe('(2%)')
    expect(fmt.pctShort(0.0725)).toBe('7.25%')
  })
  it('keeps a plus sign on positive changes', () => {
    expect(fmt.signedPct(0.315)).toBe('+31.5%')
    expect(fmt.signedPct(-0.12)).toBe('(12.0%)')
  })
  it('never shows a negative zero', () => {
    expect(fmt.pct(-0.00001)).toBe('0.0%')
    expect(fmt.pctShort(-0.000001)).toBe('0%')
  })
})
