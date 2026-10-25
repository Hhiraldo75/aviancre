import { describe, expect, it } from 'vitest'
import { SUBMARKETS } from '../../data/submarkets'
import { submarketFor } from './submarket'

describe('submarketFor', () => {
  it('maps a matching neighborhood to its submarket', () => {
    expect(submarketFor('Federal Hill', [-71.43, 41.82])).toEqual({ submarket: 'federal-hill', method: 'Federal Hill neighborhood → Federal Hill' })
    expect(submarketFor('Lower South Providence', [-71.405, 41.805]).submarket).toBe('port-allens-ave')
  })

  it('splits the Downtown neighborhood by the nearest submarket center', () => {
    expect(submarketFor('Downtown', SUBMARKETS['capital-center'].center).submarket).toBe('capital-center')
    expect(submarketFor('Downtown', SUBMARKETS['jewelry-district'].center).submarket).toBe('jewelry-district')
    const r = submarketFor('Downtown', [-71.4123, 41.8238])
    expect(r.submarket).toBe('downtown')
    expect(r.method).toMatch(/^Downtown neighborhood, nearest of the Downtown \/ Downcity, Capital Center, Jewelry District .* centers: Downtown \/ Downcity \(\d+ m\)$/)
  })

  it('uses the metro elsewhere', () => {
    expect(submarketFor('Smith Hill', [-71.42, 41.835])).toEqual({ submarket: null, method: 'Smith Hill neighborhood has no submarket: metro figures' })
    expect(submarketFor(undefined, [-71.42, 41.835]).submarket).toBeNull()
  })
})
