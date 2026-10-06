import type { AssetType, SaleComp, SubmarketId } from '../types'
import { estimate } from '../lib/sourced'

/**
 * SAMPLE sale comparables – fictional names and figures.
 * Replace with recorded deeds (City of Providence) plus broker-reported cap
 * rates; mark those with fromPublic() / fromImport().
 */
const SRC = 'Sample comp (fictional)'

function comp(
  id: string,
  name: string,
  assetType: AssetType,
  submarket: SubmarketId,
  saleDate: string,
  price: number,
  sf: number,
  capRate: number,
  buyerType: SaleComp['buyerType'],
  units?: number,
): SaleComp {
  return { id, name, assetType, submarket, saleDate, price, sf, units, capRate, buyerType, source: estimate(SRC, SRC) }
}

export const SALE_COMPS: SaleComp[] = [
  // Office
  comp('c-off-1', 'Dorrance Street Office', 'office', 'downtown', '2025-06-12', 23_100_000, 140_000, 0.089, 'private'),
  comp('c-off-2', 'Exchange Terrace Building', 'office', 'capital-center', '2024-11-20', 50_400_000, 210_000, 0.078, 'institutional'),
  comp('c-off-3', 'Weybosset Annex', 'office', 'downtown', '2023-09-08', 7_440_000, 62_000, 0.095, 'private'),
  comp('c-off-4', 'South Street Lab', 'office', 'jewelry-district', '2025-03-03', 38_950_000, 95_000, 0.071, 'institutional'),
  // Retail
  comp('c-ret-1', 'Atwells Corner Retail', 'retail', 'federal-hill', '2025-08-15', 2_945_000, 9_500, 0.068, 'private'),
  comp('c-ret-2', 'Wickenden Shops', 'retail', 'fox-point', '2024-05-30', 2_412_000, 7_200, 0.069, 'private'),
  comp('c-ret-3', 'Thayer Mixed Retail', 'retail', 'college-hill', '2023-12-14', 5_700_000, 15_000, 0.066, 'REIT'),
  // Industrial
  comp('c-ind-1', 'Valley Street Warehouse', 'industrial', 'valley', '2025-10-15', 10_450_000, 110_000, 0.068, 'institutional'),
  comp('c-ind-2', 'Olneyville Mill Industrial', 'industrial', 'olneyville', '2024-07-22', 6_630_000, 85_000, 0.072, 'private'),
  comp('c-ind-3', 'Allens Ave Terminal Building', 'industrial', 'port-allens-ave', '2026-02-09', 6_160_000, 70_000, 0.071, 'owner-user'),
  // Multifamily
  comp('c-mf-1', 'Jewelry Lofts II', 'multifamily', 'jewelry-district', '2025-04-17', 26_400_000, 84_000, 0.056, 'institutional', 96),
  comp('c-mf-2', 'Federal Hill Walk-ups', 'multifamily', 'federal-hill', '2024-09-05', 6_840_000, 30_000, 0.062, 'private', 36),
  comp('c-mf-3', 'Eagle Square Apartments', 'multifamily', 'valley', '2026-05-21', 28_800_000, 108_000, 0.058, 'institutional', 120),
]
