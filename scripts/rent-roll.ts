/**
 * Export a property's rent roll to CSV (every field the underwriting engine reads).
 *
 *   npm run rent-roll -- <property-id> [--out docs/file.csv]
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SAMPLE_PROPERTIES } from '../src/data/sampleProperties'
import { rentRollCSV } from '../src/lib/underwriting/report'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outArg = outIndex >= 0 ? args[outIndex + 1] : undefined
const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')

const commercial = SAMPLE_PROPERTIES.filter((p) => p.rentRoll.kind === 'commercial')
const property = commercial.find((p) => p.id === id)
if (!property) {
  console.error(id ? `Unknown commercial property "${id}".` : 'Usage: npm run rent-roll -- <property-id> [--out path]')
  console.error(`\nProperties: ${commercial.map((p) => p.id).join(', ')}`)
  process.exit(1)
}

const out = resolve(outArg ?? `docs/rent-roll-${property.id}.csv`)
writeFileSync(out, rentRollCSV(property))
console.log(`Wrote ${out}`)
