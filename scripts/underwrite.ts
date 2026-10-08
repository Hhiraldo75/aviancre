/**
 * Underwrite one property from the command line and write a CSV for Excel
 * checks, or with --json the machine-readable output the AI analyst reads.
 *
 *   npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--price 4500000] [--json]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SAMPLE_PROPERTIES } from '../src/data/sampleProperties'
import { todayISO } from '../src/lib/metrics'
import { defaultAssumptions, toCSV, toTable, underwrite, withPurchasePrice } from '../src/lib/underwriting'
import { analystExport } from '../src/lib/underwriting/analystExport'
import { metricRows } from '../src/lib/underwriting/report'

const USAGE = 'Usage: npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--price N] [--json]'
/** Flags that take a value; --json takes none. */
const VALUE_FLAGS = ['as-of', 'price']

function fail(message: string): never {
  console.error(message)
  console.error(`\nProperties: ${SAMPLE_PROPERTIES.map((p) => p.id).join(', ')}`)
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

const property = SAMPLE_PROPERTIES.find((p) => p.id === id) ?? fail(`Unknown property "${id}".`)
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

if (json) {
  const dir = resolve('docs', 'underwriting')
  mkdirSync(dir, { recursive: true })
  const out = resolve(dir, `${property.id}.json`)
  writeFileSync(out, JSON.stringify(analystExport(property, asOf, result), null, 2) + '\n')
  console.log(`\nWrote ${out}`)
} else {
  const out = resolve('docs', `underwriting-${property.id}.csv`)
  writeFileSync(out, toCSV(result, property.name))
  console.log(`\nWrote ${out}`)
}
