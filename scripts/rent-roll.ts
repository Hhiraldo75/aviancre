/**
 * Export a property's rent roll to CSV (every field the underwriting engine reads).
 * `npm run import` reads this format back.
 *
 *   npm run rent-roll -- <property-id> [--out docs/file.csv]
 *
 * An imported deal's export defaults to private-deals/<id>/rent-roll.csv.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { rentRollCSV } from '../src/lib/underwriting/report'
import { findProperty, outputDir, propertyList } from './deals'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outArg = outIndex >= 0 ? args[outIndex + 1] : undefined
const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')

const property = id ? findProperty(id) : undefined
if (!property || property.rentRoll.kind !== 'commercial') {
  console.error(id ? `Unknown commercial property "${id}".` : 'Usage: npm run rent-roll -- <property-id> [--out path]')
  console.error(`\n${propertyList((p) => p.rentRoll.kind === 'commercial')}`)
  process.exit(1)
}

const out = resolve(outArg ?? resolve(outputDir(property), property.importedFrom ? 'rent-roll.csv' : `rent-roll-${property.id}.csv`))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, rentRollCSV(property))
console.log(`Wrote ${out}`)
