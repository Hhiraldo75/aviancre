/**
 * Plain-language property types for Providence assessor land-use codes.
 *
 * No published code list exists, so labels follow the city's own descriptions:
 * the tax roll's `class` / `short_desc` (e.g. "6" Commercial II, "03-11+" apt 11+)
 * and the GIS parcel layer's zero-padded `MuniUseCode` / `MuniUseCodeDesc`
 * ("06", "03" Apartments, "04" Combination). `isCommercial` follows R.I.G.L.
 * § 44-5-11.8 Class 2: commercial and industrial property, mixed use, and
 * residential buildings of more than five units. Exempt property is never commercial.
 */

/** Providence's codes don't separate office from retail; those stay for a finer source. */
export type LandUseCategory =
  | 'office'
  | 'retail'
  | 'commercial'
  | 'industrial'
  | 'multifamily'
  | 'mixed-use'
  | 'residential'
  | 'exempt'
  | 'vacant land'
  | 'other'

export interface LandUse {
  /** The code as the source wrote it. */
  code: string
  label: string
  category: LandUseCategory
  isCommercial: boolean
  /** False for a code not in the table. */
  recognized: boolean
}

type Entry = [label: string, category: LandUseCategory, isCommercial: boolean]

const CODES: Record<string, Entry> = {
  '1': ['Single-family home', 'residential', false],
  '2': ['Two- to five-family home', 'residential', false],
  '23': ['Residential condo', 'residential', false],
  // GIS writes apartments and combination without the tax roll's unit band.
  '3': ['Apartments, 6+ units', 'multifamily', true],
  '03-610': ['Apartments, 6–10 units', 'multifamily', true],
  '03-11+': ['Apartments, 11+ units', 'multifamily', true],
  '4': ['Mixed use', 'mixed-use', true],
  '04-05U': ['Mixed use, up to 5 units', 'mixed-use', true],
  '04-610': ['Mixed use, 6–10 units', 'mixed-use', true],
  '04-11+': ['Mixed use, 11+ units', 'mixed-use', true],
  '5': ['Commercial (class I)', 'commercial', true],
  '6': ['Commercial (class II)', 'commercial', true],
  '24': ['Commercial condo', 'commercial', true],
  '7': ['Industrial', 'industrial', true],
  '10': ['Utility', 'other', true],
  '12': ['Other improved land', 'other', false],
  '13': ['Residential vacant land', 'vacant land', false],
  '14': ['Commercial/industrial vacant land', 'vacant land', true],
  '33': ['Farm, forest or open space', 'other', false],
  '70': ['Cemetery', 'exempt', false],
  '71': ['Charitable', 'exempt', false],
  '72': ['Religious', 'exempt', false],
  '73': ['Exempt by city charter', 'exempt', false],
  '74': ['Federal', 'exempt', false],
  '75': ['Hospital', 'exempt', false],
  '76': ['Library', 'exempt', false],
  '78': ['City-owned', 'exempt', false],
  '79': ['School', 'exempt', false],
  '80': ['State-owned', 'exempt', false],
  '82': ['Exempt by City Council vote', 'exempt', false],
  // Taxed under an agreement rather than exempt; the underlying use isn't coded.
  '83': ['Tax stabilization agreement (§ 44-3-9)', 'other', false],
  '84': ['Railroad (Amtrak)', 'exempt', false],
}

/** Decodes a tax-roll `class` or GIS `MuniUseCode`; undefined when there is no code. */
export function decodeLandUse(code: string | undefined): LandUse | undefined {
  const raw = code?.trim()
  if (!raw) return undefined
  const key = raw.toUpperCase()
  const entry = CODES[key] ?? (/^\d+$/.test(key) ? CODES[String(Number(key))] : undefined)
  if (!entry) return { code: raw, label: 'Unrecognized code', category: 'other', isCommercial: false, recognized: false }
  const [label, category, isCommercial] = entry
  return { code: raw, label, category, isCommercial, recognized: true }
}
