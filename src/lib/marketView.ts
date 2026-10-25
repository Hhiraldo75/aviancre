import type { AssetType, BenchmarkType, BuildingClass, PropertyMarketView, SubmarketBenchmark, SubmarketId } from '../types'
import { SUBMARKETS } from '../data/submarkets'
import { estimate } from './sourced'

/**
 * The benchmark a property in this submarket is priced from. Mixed-use uses
 * office, or retail where the submarket has no office benchmark; null when
 * there is none.
 */
export function benchmarkFor(
  submarketId: SubmarketId,
  assetType: AssetType,
): { type: BenchmarkType; benchmark: SubmarketBenchmark } | null {
  const benchmarks = SUBMARKETS[submarketId].benchmarks
  const candidates: BenchmarkType[] = assetType === 'mixed-use' ? ['office', 'retail'] : [assetType]
  for (const type of candidates) {
    const benchmark = benchmarks[type]
    if (benchmark) return { type, benchmark }
  }
  return null
}

/** What a missing benchmark is called in messages, e.g. "office or retail". */
export const benchmarkTypesText = (assetType: AssetType) => (assetType === 'mixed-use' ? 'office or retail' : assetType)

/**
 * Resolves a property's market view from its submarket benchmark and class.
 * This is the first, simplest layer of the rent estimation engine; comps and
 * location adjustments get layered on top later.
 */
export function marketViewFor(
  submarketId: SubmarketId,
  assetType: AssetType,
  buildingClass: BuildingClass,
): PropertyMarketView {
  const found = benchmarkFor(submarketId, assetType)
  if (!found) {
    throw new Error(`No ${benchmarkTypesText(assetType)} benchmark for submarket "${submarketId}"`)
  }
  const { benchmark } = found
  const classFactor = benchmark.classAdjustment[buildingClass]
  const base = benchmark.marketRent
  const rent = Math.round(base.value * classFactor * 100) / 100
  const range = base.range && { low: base.range.low * classFactor, high: base.range.high * classFactor }

  return {
    rentBasis: benchmark.rentBasis,
    marketRent: estimate(rent, `Submarket benchmark × class ${buildingClass} (${classFactor}×) – ${base.sourceName}`, {
      confidence: base.confidence,
      range,
      notes: base.notes,
      asOf: base.asOf,
    }),
    marketVacancy: benchmark.vacancyRate,
    marketCapRate: benchmark.marketCapRate,
    opexPerYear: benchmark.opexPerYear,
  }
}
