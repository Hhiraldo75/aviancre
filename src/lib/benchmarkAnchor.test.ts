import { describe, expect, it } from 'vitest'
import { anchorByRatio, anchorByShift, roundTo } from './benchmarkAnchor'

describe('roundTo', () => {
  it('rounds half up without float noise', () => {
    expect(roundTo(0.07675, 0.0005)).toBe(0.077)
    expect(roundTo(0.07225, 0.0005)).toBe(0.0725)
    expect(roundTo(21.154, 0.25)).toBe(21.25)
    expect(roundTo(2508.8, 5)).toBe(2510)
    expect(roundTo(0.1273, 0.001)).toBe(0.127)
  })
})

describe('anchorByShift', () => {
  it('moves every value by the same amount so the average hits the anchor', () => {
    expect(anchorByShift([0.0875, 0.08, 0.075], 0.101, 0.0005)).toEqual([0.1075, 0.1, 0.095])
  })
})

describe('anchorByRatio', () => {
  it('scales every value by the same ratio so the average hits the anchor', () => {
    expect(anchorByRatio([22, 26, 30], 25, 0.25)).toEqual([21.25, 25, 28.75])
    expect(anchorByRatio([0.2, 0.15, 0.12], 0.133, 0.001)).toEqual([0.17, 0.127, 0.102])
  })
})
