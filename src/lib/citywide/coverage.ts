import { fmt } from '../format'
import { decodeLandUse } from '../landUse'
import { RATIO_BANDS, ratioBand, SCREENING_TYPE_LABELS, SKIP_REASONS, type CitywideResult, type RatioBandId, type ScreeningType, type SkipReason } from './estimate'
import type { JoinStats } from './join'
import { medianRatios, peerRatio, type TypeMedian } from './peers'
import type { CitywideParcel } from './types'

/** What the snapshot covers, as of its refresh: printed by the script, saved in the snapshot and in docs/. */
export interface CoverageReport extends JoinStats {
  inSnapshot: number
  withBuildingArea: number
  /** Apartment and mixed-use lots, and how many of them have the city's unit count. */
  housingLots: number
  withUnitCount: number
  estimated: number
  skipped: Record<SkipReason, number>
  /** Office/retail-coded lots by how their type was set. */
  officeRetail: { office: number; retail: number; blend: number }
  inSubmarket: number
  atMetro: number
  /** Median estimate ÷ assessed by property type: what "vs peers" divides by. */
  medianRatio: Partial<Record<ScreeningType, TypeMedian>>
  /** Estimated parcels by band of their ratio vs peers (the map's colors). */
  peerBands: Record<RatioBandId, number>
}

const isHousing = (p: CitywideParcel) => ['multifamily', 'mixed-use'].includes(decodeLandUse(p.landUseCode)?.category ?? '')

export function coverageReport(stats: JoinStats, parcels: CitywideParcel[], results: CitywideResult[]): CoverageReport {
  const skipped = Object.fromEntries(Object.keys(SKIP_REASONS).map((k) => [k, 0])) as Record<SkipReason, number>
  const peerBands = Object.fromEntries([...RATIO_BANDS.map((b) => b.id), 'no-assessment'].map((k) => [k, 0])) as Record<RatioBandId, number>
  const medianRatio = medianRatios(results)
  const officeRetail = { office: 0, retail: 0, blend: 0 }
  let estimated = 0
  let inSubmarket = 0
  for (const r of results) {
    if (r.status === 'skipped') {
      skipped[r.reason]++
      continue
    }
    estimated++
    peerBands[ratioBand(peerRatio(r, medianRatio))]++
    if (r.market.submarket) inSubmarket++
    if (r.type === 'office' || r.type === 'retail') officeRetail[r.type]++
    if (r.type === 'commercial') officeRetail.blend++
  }
  const housing = parcels.filter(isHousing)
  return {
    ...stats,
    inSnapshot: parcels.length,
    withBuildingArea: parcels.filter((p) => p.gba).length,
    housingLots: housing.length,
    withUnitCount: housing.filter((p) => p.units).length,
    estimated,
    skipped,
    officeRetail,
    inSubmarket,
    atMetro: estimated - inSubmarket,
    medianRatio,
    peerBands,
  }
}

/** The report as Markdown lines (a table plus breakdowns), for the console and docs/citywide-coverage.md. */
export function coverageLines(r: CoverageReport): string[] {
  const n = fmt.int
  const share = (x: number, of: number) => (of ? ` (${fmt.pct(x / of, 0)})` : '')
  return [
    '| | Lots |',
    '|---|---:|',
    `| Commercial lots on the 2025 tax roll (${n(r.taxRollRecords)} records) | ${n(r.commercialLots)} |`,
    `| No row in the city parcel layer | ${n(r.noCityParcel)} |`,
    `| Left out: no outline and no tax-roll point | ${n(r.noLocation)} |`,
    `| In the snapshot | ${n(r.inSnapshot)} |`,
    `| With building area | ${n(r.withBuildingArea)}${share(r.withBuildingArea, r.inSnapshot)} |`,
    `| Apartments and mixed use with a unit count | ${n(r.withUnitCount)} of ${n(r.housingLots)} |`,
    `| **Estimated** | **${n(r.estimated)}**${share(r.estimated, r.inSnapshot)} |`,
    ...(Object.entries(r.skipped) as [SkipReason, number][]).filter(([, c]) => c > 0).map(([k, c]) => `| Skipped: ${SKIP_REASONS[k]} | ${n(c)} |`),
    '',
    `By land use: ${Object.entries(r.byLandUse)
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k} ${n(c)}`)
      .join(' · ')}`,
    '',
    `Office/retail-coded lots estimated: ${n(r.officeRetail.office)} office and ${n(r.officeRetail.retail)} retail from OpenStreetMap tags, ${n(r.officeRetail.blend)} blended (low confidence).`,
    `Priced in a submarket: ${n(r.inSubmarket)}; at the metro figures: ${n(r.atMetro)}.`,
    '',
    'Median estimate ÷ assessed by property type (1.0× vs peers):',
    '',
    '| Type | Median | Parcels |',
    '|---|---:|---:|',
    ...(Object.entries(r.medianRatio) as [ScreeningType, TypeMedian][])
      .sort((a, b) => b[1].count - a[1].count)
      .map(([t, m]) => `| ${SCREENING_TYPE_LABELS[t]} | ${m.median.toFixed(2)}× | ${n(m.count)} |`),
    '',
    'Map colors, estimate ÷ assessed vs peers:',
    '',
    '| Band | Parcels | Share |',
    '|---|---:|---:|',
    ...[...RATIO_BANDS, { id: 'no-assessment' as const, label: 'No assessment' }].map(
      (b) => `| ${b.label} | ${n(r.peerBands[b.id])} | ${fmt.pct(r.estimated ? r.peerBands[b.id] / r.estimated : 0)} |`,
    ),
  ]
}
