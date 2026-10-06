import type { AssetType, BuildingClass, PropertyMarketView, SubmarketId } from '../types'
import { SUBMARKETS } from '../data/submarkets'
import { estimateWithBand } from './sourced'

/**
 * Resolves a property's market view from its submarket benchmark and class.
 * This is the first, simplest layer of the rent estimation engine; comps and
 * location adjustments get layered on top later.
 *
 * Mixed-use falls back to office benchmarks.
 */
export function marketViewFor(
  submarketId: SubmarketId,
  assetType: AssetType,
  buildingClass: BuildingClass,
): PropertyMarketView {
  const lookupType = assetType === 'mixed-use' ? 'office' : assetType
  const benchmark = SUBMARKETS[submarketId].benchmarks[lookupType]
  if (!benchmark) {
    throw new Error(`No ${lookupType} benchmark for submarket "${submarketId}"`)
  }

  const classFactor = benchmark.classAdjustment[buildingClass]
  const rent = Math.round(benchmark.marketRent.value * classFactor * 100) / 100

  return {
    rentBasis: benchmark.rentBasis,
    marketRent: estimateWithBand(
      rent,
      `Submarket benchmark × class ${buildingClass} (${classFactor}×)`,
      0.12,
    ),
    marketVacancy: benchmark.vacancyRate,
    marketCapRate: benchmark.marketCapRate,
    opexPerYear: benchmark.opexPerYear,
  }
}
