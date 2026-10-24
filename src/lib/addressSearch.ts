import type { Property } from '../types'

/**
 * Address search against the city's parcel layer (`ParcAddress`), whose
 * addresses look like "1000 Westminster St", "1029 Westminster St Unit 1A",
 * "131-135 Brown St" or "800 North Main": USPS suffix abbreviations, spelled-out
 * directions, one feature per condo unit.
 */

/** Full street suffixes → the abbreviations the city's records use. */
const SUFFIXES: Record<string, string> = {
  STREET: 'ST',
  AVENUE: 'AVE',
  AV: 'AVE',
  BOULEVARD: 'BLVD',
  PLACE: 'PL',
  PLAZA: 'PLZ',
  TERRACE: 'TER',
  SQUARE: 'SQ',
  ROAD: 'RD',
  DRIVE: 'DR',
  COURT: 'CT',
  LANE: 'LN',
  PARKWAY: 'PKWY',
  CIRCLE: 'CIR',
  HIGHWAY: 'HWY',
}
const SUFFIX_WORDS = new Set([...Object.keys(SUFFIXES), ...Object.values(SUFFIXES), 'WAY'])
const DIRECTIONS: Record<string, string> = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' }

/** "Unit 1A", "Apt 3", "Ste 200", "#2" and the like, with whatever follows. */
const UNIT = /(?:#|\b(?:UNIT|APT|APARTMENT|STE|SUITE|FL|FLOOR|RM|ROOM)\b)\.?\s*[A-Z0-9-]*/g
const ZIP = /^\d{5}(-\d{4})?$/
const HOUSE_NUMBER = /^\d+[A-Z]?(-\d+[A-Z]?)?$/

/**
 * One canonical form for comparing addresses: upper case, no unit, no city,
 * state or ZIP, the record's suffix abbreviation and spelled-out direction.
 * "100 westminster street, Unit 2, Providence, RI 02903" → "100 WESTMINSTER ST".
 */
export function normalizeAddress(text: string): string {
  const tokens = text
    .toUpperCase()
    .split(',')[0]
    .replace(UNIT, ' ')
    .replace(/[^A-Z0-9 '-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  // Trailing city, state or ZIP typed without a comma.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]
    if (ZIP.test(last) || last === 'RI' || last === 'PROVIDENCE') tokens.pop()
    else if (last === 'ISLAND' && tokens[tokens.length - 2] === 'RHODE') tokens.splice(-2)
    else break
  }

  const first = tokens.length > 0 && HOUSE_NUMBER.test(tokens[0]) ? 1 : 0
  const name = tokens.length - first
  // Only the last word is a suffix, and only after a street name ("Court St" stays "COURT ST").
  if (name >= 2) {
    const last = tokens[tokens.length - 1]
    tokens[tokens.length - 1] = SUFFIXES[last] ?? last
  }
  if (name >= 2 && DIRECTIONS[tokens[first]]) tokens[first] = DIRECTIONS[tokens[first]]
  return tokens.join(' ')
}

export interface AddressQuery {
  /** The whole input, normalized (see `normalizeAddress`). */
  text: string
  /** House number or range, e.g. "100", "131-135". */
  number?: string
  /** Street name words, without the suffix. */
  words: string[]
  /** Typed suffix, possibly partial ("ST", "STRE"); not sent to the server, since some records have none. */
  suffix?: string
}

/** Minimum typed characters (ignoring spaces) before searching. */
export const MIN_QUERY_CHARS = 3

/** Parses typed text; null when it's too short to search. */
export function parseAddressQuery(input: string): AddressQuery | null {
  const text = normalizeAddress(input)
  if (text.replace(/\s/g, '').length < MIN_QUERY_CHARS) return null
  const words = text.split(' ')
  const number = HOUSE_NUMBER.test(words[0]) ? words.shift() : undefined
  let suffix: string | undefined
  const last = words[words.length - 1]
  if (words.length >= 2 && [...SUFFIX_WORDS].some((s) => s.startsWith(last))) suffix = words.pop()
  return { text, number, words, suffix }
}

/** Only letters, digits, spaces, hyphens and doubled apostrophes reach the SQL. */
function sqlText(s: string): string {
  return s.replace(/[^A-Z0-9 '-]/g, '').replace(/'/g, "''")
}

/** ArcGIS `where` clause for the parcel layer: house number and street name, matched at the start of a word. */
export function addressWhereClause(q: AddressQuery): string {
  const name = sqlText(q.words.join(' '))
  const num = q.number && sqlText(q.number)
  // A typed single number also matches ranges that start with it: "131" finds "131-135 Brown St".
  const patterns = num
    ? [`${num} ${name}%`, ...(num.includes('-') ? [] : [`${num}-% ${name}%`])]
    : [`${name}%`, `% ${name}%`]
  return patterns.map((p) => `UPPER(ParcAddress) LIKE '${p}'`).join(' OR ')
}

export interface ParcelSuggestion {
  pin: string
  /** As the city records it, without the unit. */
  address: string
  /** Condo units on this parcel (0 when the records name none). */
  units: number
}

const UNIT_PART = /\s+(?:UNIT|APT|STE|SUITE|#)\s*(.*)$/i

function houseNumber(normalized: string): number {
  const n = Number.parseInt(normalized, 10)
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

/**
 * One suggestion per parcel (condo units share a PIN), best first: the exact
 * address, then ones starting with what was typed, then by street and number.
 */
export function rankParcelSuggestions(rows: Record<string, unknown>[], q: AddressQuery, limit = 8): ParcelSuggestion[] {
  const byPin = new Map<string, { address: string; units: Set<string> }>()
  for (const row of rows) {
    const pin = typeof row.PIN === 'string' || typeof row.PIN === 'number' ? String(row.PIN).trim() : ''
    const raw = typeof row.ParcAddress === 'string' ? row.ParcAddress.trim().replace(/\s+/g, ' ') : ''
    if (!pin || !raw) continue
    const unit = raw.match(UNIT_PART)?.[1]
    const address = raw.replace(UNIT_PART, '')
    const entry = byPin.get(pin) ?? { address, units: new Set<string>() }
    if (unit) entry.units.add(unit.toUpperCase())
    byPin.set(pin, entry)
  }

  const rank = (normalized: string) => (normalized === q.text ? 0 : normalized.startsWith(q.text) ? 1 : 2)
  return [...byPin]
    .map(([pin, { address, units }]) => {
      const normalized = normalizeAddress(address)
      return { pin, address, units: units.size, normalized, street: normalized.replace(/^\S*\d\S*\s+/, '') }
    })
    .sort(
      (a, b) =>
        rank(a.normalized) - rank(b.normalized) ||
        a.street.localeCompare(b.street) ||
        houseNumber(a.normalized) - houseNumber(b.normalized) ||
        a.normalized.localeCompare(b.normalized),
    )
    .slice(0, limit)
    .map(({ pin, address, units }) => ({ pin, address, units }))
}

/**
 * The one parcel whose address is the given one, unit, city and suffix
 * spelling aside; null when none or several are. A range ("131-135 Brown St")
 * is not an exact match for one of its numbers.
 */
export function exactAddressMatch(suggestions: ParcelSuggestion[], address: string): ParcelSuggestion | null {
  const target = normalizeAddress(address)
  const exact = suggestions.filter((s) => normalizeAddress(s.address) === target)
  return exact.length === 1 ? exact[0] : null
}

const startsWord = (haystack: string, needle: string) => haystack.startsWith(needle) || haystack.includes(` ${needle}`)

/**
 * Sample properties and imported deals whose name or address matches, matched
 * here in the browser only: imported deals never leave it.
 */
export function matchLocalProperties(properties: Property[], input: string, limit = 3): Property[] {
  const q = parseAddressQuery(input)
  if (!q) return []
  const core = [q.number, ...q.words].filter(Boolean).join(' ')
  const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  const name = plain(input)
  return properties
    .filter((p) => {
      const address = normalizeAddress(p.location.address)
      return startsWord(address, q.text) || startsWord(address, core) || (name !== '' && startsWord(plain(p.name), name))
    })
    .slice(0, limit)
}
