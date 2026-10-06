import type { ISODate, Property } from '../types'
import { isLeaseActive } from './metrics'

export interface StackSegment {
  key: string
  label: string
  sf: number
  kind: 'lease' | 'vacant'
  expirationYear?: number
}

export interface StackFloor {
  floor: number
  segments: StackSegment[]
  totalSF: number
}

/**
 * Builds a stacking plan (floors top-down, with tenants on each) from leases
 * and vacancies that carry `floors`. Multi-floor leases split SF evenly.
 * Floors with nothing assigned come back empty (lobby, mechanical, common area).
 * Returns null when no floor data exists.
 */
export function stackingPlan(p: Property, asOf: ISODate): StackFloor[] | null {
  if (p.rentRoll.kind !== 'commercial') return null
  const { leases, vacancies } = p.rentRoll
  const hasFloors = leases.some((l) => l.floors?.length) || vacancies.some((v) => v.floors?.length)
  if (!hasFloors) return null

  const floorCount = p.physical.floors.value
  const byFloor = new Map<number, StackSegment[]>()
  for (let f = 1; f <= floorCount; f++) byFloor.set(f, [])

  const add = (floors: number[] | undefined, seg: Omit<StackSegment, 'sf'>, totalSF: number) => {
    if (!floors?.length) return
    for (const f of floors) byFloor.get(f)?.push({ ...seg, sf: totalSF / floors.length })
  }

  for (const l of leases) {
    if (!isLeaseActive(l, asOf)) continue
    add(l.floors, { key: l.id, label: l.tenantName, kind: 'lease', expirationYear: Number(l.expirationDate.slice(0, 4)) }, l.leasedSF)
  }
  for (const v of vacancies) add(v.floors, { key: v.id, label: `Vacant – ${v.suite}`, kind: 'vacant' }, v.sf)

  return [...byFloor.entries()]
    .sort(([a], [b]) => b - a)
    .map(([floor, segments]) => ({ floor, segments, totalSF: segments.reduce((s, x) => s + x.sf, 0) }))
}
