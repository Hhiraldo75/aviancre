/**
 * Properties the CLI scripts can work on: the samples, plus imported deals
 * saved by `npm run import` as private-deals/<id>.json. Output for an
 * imported deal goes under private-deals/<id>/, never docs/, so nothing about
 * a real deal is ever committed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SAMPLE_PROPERTIES } from '../src/data/sampleProperties'
import { propertyFromDealFile } from '../src/lib/importedDeals'
import type { Property } from '../src/types'
import { PRIVATE_DIR } from './privateDeals'

export const dealPath = (id: string) => resolve(PRIVATE_DIR, `${id}.json`)

/** Ids of the deals saved in private-deals/. */
export function privateDealIds(): string[] {
  if (!existsSync(PRIVATE_DIR)) return []
  return readdirSync(PRIVATE_DIR)
    .filter((f) => f.startsWith('deal-') && f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
}

/** A sample property or a saved private deal; throws when a deal file is unreadable. */
export function findProperty(id: string): Property | undefined {
  const sample = SAMPLE_PROPERTIES.find((p) => p.id === id)
  if (sample) return sample
  const path = dealPath(id)
  if (!existsSync(path)) return undefined
  const property = propertyFromDealFile(JSON.parse(readFileSync(path, 'utf8')))
  if (!property) throw new Error(`${path} is not an AVIANCRE deal file. Re-create it with npm run import.`)
  return property
}

/** Where a script writes its output for this property. */
export function outputDir(property: Property): string {
  return property.importedFrom ? resolve(PRIVATE_DIR, property.id) : resolve('docs')
}

/** "Properties: …" and "Private deals: …" lines for usage errors. */
export function propertyList(filter: (p: Property) => boolean = () => true): string {
  const samples = SAMPLE_PROPERTIES.filter(filter).map((p) => p.id)
  const deals = privateDealIds()
  return [`Properties: ${samples.join(', ')}`, deals.length ? `Private deals (${PRIVATE_DIR}/): ${deals.join(', ')}` : '']
    .filter(Boolean)
    .join('\n')
}
