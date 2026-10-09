import type { Property } from '../types'
import { isImportedDealId } from './rentRollImport'

/**
 * Imported deals at rest: browser local storage in the app, private-deals/<id>.json
 * on the command line. Both hold Properties built by `parseRentRoll`; this checks
 * a stored one still has the shape the engine needs before it is loaded.
 */

export const DEAL_FILE_FORMAT = 'aviancre-deal'
export const DEAL_FILE_VERSION = 1

/** private-deals/<id>.json */
export interface DealFile {
  format: typeof DEAL_FILE_FORMAT
  version: typeof DEAL_FILE_VERSION
  property: Property
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

const isSourcedNumber = (x: unknown) => isObject(x) && typeof x.value === 'number' && typeof x.source === 'string'

/** A structural check, not a full schema: enough to reject stale or hand-edited entries. */
export function isImportedDeal(x: unknown): x is Property {
  if (!isObject(x) || typeof x.id !== 'string' || !isImportedDealId(x.id) || typeof x.name !== 'string') return false
  if (!isObject(x.importedFrom) || !isObject(x.location) || !isObject(x.physical) || !isObject(x.market)) return false
  if (!isSourcedNumber(x.physical.rentableSF) || !isSourcedNumber(x.market.marketRent) || !isSourcedNumber(x.market.marketCapRate)) return false
  const rr = x.rentRoll
  return isObject(rr) && rr.kind === 'commercial' && Array.isArray(rr.leases) && Array.isArray(rr.vacancies)
}

export function dealFile(property: Property): DealFile {
  return { format: DEAL_FILE_FORMAT, version: DEAL_FILE_VERSION, property }
}

/** The property in a parsed private-deals/<id>.json, or null when the file isn't a deal. */
export function propertyFromDealFile(x: unknown): Property | null {
  if (!isObject(x) || x.format !== DEAL_FILE_FORMAT || x.version !== DEAL_FILE_VERSION) return null
  return isImportedDeal(x.property) ? x.property : null
}
