import type { BuildingClass, Submarket, SubmarketBenchmark, SubmarketId } from '../types'
import { estimate, estimateWithBand } from '../lib/sourced'

/**
 * PLACEHOLDER market benchmarks for Providence submarkets.
 *
 * These are illustrative round numbers so the app has something to compute
 * with. They are NOT market data. Replace each `sourceName` and value with
 * figures from quarterly market reports (CBRE, Cushman & Wakefield, JLL,
 * Colliers publish free Providence/RI reports), HUD Fair Market Rents, and
 * Census ACS for multifamily. Then flip `source` to 'public' and add `asOf`.
 */
const PLACEHOLDER = 'Placeholder benchmark – replace with quarterly market report'

/** Class B is the baseline; A trades at a premium, C at a discount. */
const OFFICE_CLASS: Record<BuildingClass, number> = { A: 1.25, B: 1, C: 0.8 }
const RETAIL_CLASS: Record<BuildingClass, number> = { A: 1.2, B: 1, C: 0.85 }
const INDUSTRIAL_CLASS: Record<BuildingClass, number> = { A: 1.15, B: 1, C: 0.82 }
const MF_CLASS: Record<BuildingClass, number> = { A: 1.2, B: 1, C: 0.85 }

function office(rent: number, vacancy: number, capRate: number): SubmarketBenchmark {
  return {
    rentBasis: 'annual-per-sf',
    marketRent: estimateWithBand(rent, PLACEHOLDER, 0.12),
    classAdjustment: OFFICE_CLASS,
    vacancyRate: estimate(vacancy, PLACEHOLDER),
    annualRentGrowth: estimate(0.015, PLACEHOLDER),
    marketCapRate: estimate(capRate, PLACEHOLDER),
    opexPerYear: estimate(10.5, PLACEHOLDER, { notes: 'Per SF, full-service office' }),
  }
}

function retail(rent: number, vacancy: number, capRate: number): SubmarketBenchmark {
  return {
    rentBasis: 'annual-per-sf',
    marketRent: estimateWithBand(rent, PLACEHOLDER, 0.15),
    classAdjustment: RETAIL_CLASS,
    vacancyRate: estimate(vacancy, PLACEHOLDER),
    annualRentGrowth: estimate(0.02, PLACEHOLDER),
    marketCapRate: estimate(capRate, PLACEHOLDER),
    opexPerYear: estimate(7, PLACEHOLDER, { notes: 'Per SF, NNN pass-throughs' }),
  }
}

function industrial(rent: number, vacancy: number, capRate: number): SubmarketBenchmark {
  return {
    rentBasis: 'annual-per-sf',
    marketRent: estimateWithBand(rent, PLACEHOLDER, 0.1),
    classAdjustment: INDUSTRIAL_CLASS,
    vacancyRate: estimate(vacancy, PLACEHOLDER),
    annualRentGrowth: estimate(0.035, PLACEHOLDER),
    marketCapRate: estimate(capRate, PLACEHOLDER),
    opexPerYear: estimate(3.25, PLACEHOLDER, { notes: 'Per SF, NNN pass-throughs' }),
  }
}

function multifamily(rentPerUnit: number, vacancy: number, capRate: number): SubmarketBenchmark {
  return {
    rentBasis: 'monthly-per-unit',
    marketRent: estimateWithBand(rentPerUnit, PLACEHOLDER, 0.1),
    classAdjustment: MF_CLASS,
    vacancyRate: estimate(vacancy, PLACEHOLDER),
    annualRentGrowth: estimate(0.03, PLACEHOLDER),
    marketCapRate: estimate(capRate, PLACEHOLDER),
    opexPerYear: estimate(6800, PLACEHOLDER, { notes: 'Per unit per year' }),
  }
}

export const SUBMARKETS: Record<SubmarketId, Submarket> = {
  downtown: {
    id: 'downtown',
    name: 'Downtown / Downcity',
    center: [-71.4125, 41.8240],
    benchmarks: {
      office: office(22, 0.2, 0.0875),
      retail: retail(20, 0.11, 0.0775),
      multifamily: multifamily(2100, 0.055, 0.0575),
    },
  },
  'capital-center': {
    id: 'capital-center',
    name: 'Capital Center',
    center: [-71.4135, 41.8290],
    benchmarks: {
      office: office(26, 0.15, 0.08),
      retail: retail(24, 0.09, 0.0725),
      multifamily: multifamily(2400, 0.05, 0.055),
    },
  },
  'jewelry-district': {
    id: 'jewelry-district',
    name: 'Jewelry District / Innovation District',
    center: [-71.4085, 41.8185],
    benchmarks: {
      office: office(30, 0.12, 0.075),
      retail: retail(22, 0.1, 0.075),
      multifamily: multifamily(2300, 0.05, 0.055),
    },
  },
  'federal-hill': {
    id: 'federal-hill',
    name: 'Federal Hill',
    center: [-71.4270, 41.8230],
    benchmarks: {
      retail: retail(22, 0.07, 0.07),
      multifamily: multifamily(1700, 0.04, 0.06),
    },
  },
  'fox-point': {
    id: 'fox-point',
    name: 'Fox Point / Wickenden',
    center: [-71.3990, 41.8195],
    benchmarks: {
      retail: retail(26, 0.08, 0.07),
      multifamily: multifamily(1900, 0.04, 0.0575),
    },
  },
  'college-hill': {
    id: 'college-hill',
    name: 'College Hill / Thayer St',
    center: [-71.4005, 41.8290],
    benchmarks: {
      retail: retail(32, 0.06, 0.0675),
      multifamily: multifamily(2200, 0.03, 0.055),
    },
  },
  olneyville: {
    id: 'olneyville',
    name: 'Olneyville',
    center: [-71.4430, 41.8190],
    benchmarks: {
      industrial: industrial(9.5, 0.04, 0.07),
      retail: retail(16, 0.1, 0.08),
      multifamily: multifamily(1500, 0.05, 0.0625),
    },
  },
  valley: {
    id: 'valley',
    name: 'Valley / Eagle Square',
    center: [-71.4290, 41.8300],
    benchmarks: {
      industrial: industrial(10, 0.045, 0.07),
      retail: retail(18, 0.09, 0.0775),
      multifamily: multifamily(1650, 0.05, 0.06),
    },
  },
  'port-allens-ave': {
    id: 'port-allens-ave',
    name: 'Port of Providence / Allens Ave',
    center: [-71.4040, 41.8020],
    benchmarks: {
      industrial: industrial(9, 0.05, 0.0725),
    },
  },
}

// ---------- generated sample trend history ----------

const TREND_YEARS = [2022, 2023, 2024, 2025, 2026]
/** Rough shape of the post-2022 rate cycle: caps rose into 2024, then leveled off. */
const CAP_OFFSET: Record<number, number> = { 2022: -0.0125, 2023: -0.006, 2024: 0.001, 2025: 0.0015, 2026: 0 }
/** Per-year vacancy drift looking backward (office vacancy has been rising, etc.). */
const VACANCY_DRIFT: Record<string, number> = { office: 0.012, industrial: 0.006, retail: -0.004, multifamily: 0.002, 'mixed-use': 0.008 }

/**
 * Back-casts five years of SAMPLE history from each current benchmark so the
 * Analyst view has something to chart. Replace with real report history.
 */
for (const sm of Object.values(SUBMARKETS)) {
  sm.trends = {}
  for (const [type, b] of Object.entries(sm.benchmarks)) {
    if (!b) continue
    const g = b.annualRentGrowth.value
    const drift = VACANCY_DRIFT[type] ?? 0
    sm.trends[type as keyof typeof sm.benchmarks] = TREND_YEARS.map((year) => {
      const yearsBack = 2026 - year
      return {
        year,
        marketRent: Math.round((b.marketRent.value / Math.pow(1 + g, yearsBack)) * 100) / 100,
        vacancyRate: Math.max(0.01, b.vacancyRate.value - drift * yearsBack),
        capRate: b.marketCapRate.value + CAP_OFFSET[year],
      }
    })
  }
}

export const TREND_SOURCE = 'Sample trend – generated from placeholder benchmarks'
