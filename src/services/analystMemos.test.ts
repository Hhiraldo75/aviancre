import { describe, expect, it } from 'vitest'
import { loadAnalystMemo, memoDate, withoutDisclaimer } from './analystMemos'

describe('analyst memos', () => {
  it('loads a memo from docs/memos by property id', async () => {
    const md = await loadAnalystMemo('sample-atwells-retail-row')
    expect(md).toMatch(/^\*AI-generated analysis of sample data/)
  })
  it('returns null when a property has no memo', async () => {
    expect(await loadAnalystMemo('no-such-property')).toBeNull()
  })
  it('reads the date from the "As of" line', () => {
    expect(memoDate('*label*\n\n# Title\n\nAs of 2026-10-08 · Base scenario')).toBe('2026-10-08')
    expect(memoDate('# Title\n\nNo date here')).toBeNull()
  })
  it('drops only the leading italic disclaimer line', () => {
    expect(withoutDisclaimer('*AI-generated analysis of sample data.*\n\n# Title\n\nBody')).toBe('# Title\n\nBody')
    expect(withoutDisclaimer('_Disclaimer._\n# Title')).toBe('# Title')
    expect(withoutDisclaimer('# Title\n\n*Not first, kept.*')).toBe('# Title\n\n*Not first, kept.*')
    expect(withoutDisclaimer('**Bold lead**\n\n# Title')).toBe('**Bold lead**\n\n# Title')
    expect(withoutDisclaimer('*Italic* then plain text\n# Title')).toBe('*Italic* then plain text\n# Title')
  })
  it('strips the disclaimer from the Atwells memo', async () => {
    const md = (await loadAnalystMemo('sample-atwells-retail-row'))!
    expect(withoutDisclaimer(md)).toMatch(/^# Atwells Retail Row/)
  })
})
