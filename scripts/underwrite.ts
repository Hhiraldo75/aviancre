/**
 * Underwrite one property from the command line and write a CSV for Excel
 * checks, or with --json the machine-readable output the AI analyst reads.
 * Works on sample properties and on deals saved by `npm run import`; a
 * deal's output goes to private-deals/<id>/ instead of docs/.
 *
 *   npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--price 4500000] [--json]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { todayISO } from '../src/lib/metrics'
import { defaultAssumptions, toCSV, toTable, underwrite, withPurchasePrice } from '../src/lib/underwriting'
import { analystExport } from '../src/lib/underwriting/analystExport'
import { metricRows } from '../src/lib/underwriting/report'
import { findProperty, outputDir, propertyList } from './deals'

const USAGE = 'Usage: npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--price N] [--json]'
/** Flags that take a value; --json takes none. */
const VALUE_FLAGS = ['as-of', 'price']

function fail(message: string): never {
  console.error(message)
  console.error(`\n${propertyList()}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const isFlagValue = (i: number) => VALUE_FLAGS.some((f) => args[i - 1] === `--${f}`)
const unknown = args.find((a) => a.startsWith('--') && !VALUE_FLAGS.includes(a.slice(2)) && a !== '--json')
if (unknown) fail(`Unknown option "${unknown}". ${USAGE}`)
const json = args.includes('--json')
const id = args.find((a, i) => !a.startsWith('--') && !isFlagValue(i))
if (!id) fail(USAGE)

let found
try {
  found = findProperty(id)
} catch (err) {
  fail((err as Error).message)
}
const property = found ?? fail(`Unknown property "${id}".`)
const asOf = flag('as-of') ?? todayISO()
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail(`--as-of must be YYYY-MM-DD, got "${asOf}".`)
const price = flag('price')

let assumptions = defaultAssumptions(property, asOf)
if (price !== undefined) {
  const n = Number(price)
  if (!Number.isFinite(n) || n <= 0) fail(`--price must be a positive number, got "${price}".`)
  assumptions = withPurchasePrice(assumptions, n)
}
const result = underwrite(property, asOf, assumptions)

console.log(`\n${property.name} (${property.assetType}, ${property.physical.rentableSF.value.toLocaleString('en-US')} RSF)`)
console.log(`As of ${asOf}; analysis starts ${result.assumptions.acquisition.analysisStartDate}\n`)
console.log(toTable(result))
console.log('\nMetrics')
const width = Math.max(...metricRows(result).map(([label]) => label.length)) + 2
for (const [label, value] of metricRows(result)) console.log(`  ${label.padEnd(width)}${value}`)
console.log('\nWarnings')
for (const w of result.warnings) console.log(`  - ${w}`)
if (!result.warnings.length) console.log('  (none)')

// Samples: docs/underwriting/<id>.json and docs/underwriting-<id>.csv.
// Imported deals: private-deals/<id>/underwriting.json and underwriting.csv.
const dir = outputDir(property)
const isDeal = property.importedFrom !== undefined
const out = json
  ? resolve(dir, isDeal ? 'underwriting.json' : `underwriting/${property.id}.json`)
  : resolve(dir, isDeal ? 'underwriting.csv' : `underwriting-${property.id}.csv`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, json ? JSON.stringify(analystExport(property, asOf, result), null, 2) + '\n' : toCSV(result, property.name))
console.log(`\nWrote ${out}`)
