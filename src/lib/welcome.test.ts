import { describe, expect, it } from 'vitest'
import { shouldShowWelcome } from './welcome'

describe('shouldShowWelcome', () => {
  it('shows on a first visit with a plain link', () => {
    expect(shouldShowWelcome('', false)).toBe(true)
    expect(shouldShowWelcome('?', false)).toBe(true)
  })

  it('never shows once seen', () => {
    expect(shouldShowWelcome('', true)).toBe(false)
  })

  it('stays hidden when the link sets filters or a sort', () => {
    expect(shouldShowWelcome('?type=retail', false)).toBe(false)
    expect(shouldShowWelcome('?sf=10000-50000&occ=80-90', false)).toBe(false)
    expect(shouldShowWelcome('?sort=irr', false)).toBe(false)
  })

  it('ignores unknown or malformed parameters', () => {
    expect(shouldShowWelcome('?utm_source=x&type=castle&sf=abc', false)).toBe(true)
  })
})
