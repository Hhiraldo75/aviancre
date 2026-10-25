import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeLandUse } from '../landUse'
import type { CitywideOutlines, CitywideSnapshot } from './types'

const read = <T>(file: string): T => JSON.parse(readFileSync(resolve('public/data/citywide', file), 'utf8')) as T

describe('committed citywide snapshot', () => {
  const snapshot = read<CitywideSnapshot>('parcels.json')
  const outlines = read<CitywideOutlines>('outlines.json')

  it('has its coverage and sources', () => {
    expect(snapshot.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snapshot.meta.coverage.inSnapshot).toBe(snapshot.parcels.length)
    expect(snapshot.meta.coverage.commercialLots).toBe(snapshot.parcels.length + snapshot.meta.coverage.noLocation)
    expect(snapshot.meta.sources.length).toBeGreaterThanOrEqual(4)
  })

  it('holds only commercial lots, one per PIN, each with a point', () => {
    expect(snapshot.parcels.length).toBeGreaterThan(1000)
    expect(snapshot.parcels.every((p) => decodeLandUse(p.landUseCode)?.isCommercial)).toBe(true)
    expect(new Set(snapshot.parcels.map((p) => p.pin)).size).toBe(snapshot.parcels.length)
    expect(snapshot.parcels.every((p) => p.point.every(Number.isFinite))).toBe(true)
  })

  it('has outlines only for parcels in the snapshot', () => {
    const pins = new Set(snapshot.parcels.map((p) => p.pin))
    expect(Object.keys(outlines).every((pin) => pins.has(pin))).toBe(true)
  })
})
