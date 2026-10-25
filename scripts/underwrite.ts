/**
 * Underwrite one property from the command line and write a CSV for Excel
 * checks, or with --json the machine-readable output the AI analyst reads.
 * Works on sample properties and on deals saved by `npm run import`; a
 * deal's output goes to private-deals/<id>/ instead of docs/.
 *
 *   npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price 4500000]
 *                         [--scenario base|downside|upside] [--json]
 *
 * --assumptions runs a set exported from Full underwriting > Assumptions;
 * --price is applied on top of it as one more change. --scenario runs the
 * Downside or Upside case of that (with the set's edited presets, if any);
 * its files get a "--downside"/"--upside" suffix so Base files stay as they are.
 * Every run also prints Base, Downside and Upside side by side.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { todayISO } from '../src/lib/metrics'
import { toCSV, toTable, underwrite } from '../src/lib/underwriting'
import { analystExport } from '../src/lib/underwriting/analystExport'
import { DEFAULTS_SET, parseAssumptionSetFile, setSummary } from '../src/lib/underwriting/assumptionSets'
import { assumptionsFor, type AssumptionEdits } from '../src/lib/underwriting/edits'
import { SCENARIO_LABELS, SCENARIOS, scenarioChanges, scenarioComparison, withScenario } from '../src/lib/underwriting/scenarios'
import { metricRows } from '../src/lib/underwriting/report'
import { sensitivityGrids } from '../src/lib/underwriting/sensitivity'
import type { Scenario } from '../src/types'
import { findProperty, outputDir, propertyList } from './deals'
import { PRIVATE_DIR } from './privateDeals'

const USAGE =
  'Usage: npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price N] [--scenario base|downside|upside] [--json]'
/** Flags that take a value; --json takes none. */
const VALUE_FLAGS = ['as-of', 'price', 'assumptions', 'scenario']

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
const scenarioFlag = flag('scenario') ?? 'base'
if (!(SCENARIOS as readonly string[]).includes(scenarioFlag)) fail(`--scenario must be base, downside or upside, got "${scenarioFlag}".`)
const scenario = scenarioFlag as Scenario

// The assumption set: Defaults, or an exported set file, plus --price as one more change.
let setName = DEFAULTS_SET
let edits: AssumptionEdits = {}
const setPath = flag('assumptions')
if (setPath !== undefined) {
  if (!existsSync(setPath)) fail(`No such assumption set file: ${setPath}`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(setPath, 'utf8'))
  } catch {
    fail(`${setPath} is not valid JSON.`)
  }
  const parsed = parseAssumptionSetFile(json, property, asOf)
  if (!parsed.set) fail(`${setPath} can't be used:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`)
  setName = parsed.set.name
  edits = parsed.set.edits
  if (property.importedFrom && relative(resolve(PRIVATE_DIR, property.id), resolve(setPath)).startsWith('..')) {
    console.log(`Note: keep ${property.id}'s assumption sets in ${PRIVATE_DIR}/${property.id}/ so Git never picks them up.`)
  }
}
if (price !== undefined) {
  const n = Number(price)
  if (!Number.isFinite(n) || n <= 0) fail(`--price must be a positive number, got "${price}".`)
  edits = { ...edits, 'acquisition.purchasePrice': n }
  setName = `${setName} + --price`
}
const base = assumptionsFor(property, asOf, edits)
const result = underwrite(property, asOf, withScenario(base, scenario, edits))
const sensitivityWarnings = sensitivityGrids(property, asOf, result.assumptions).warnings

console.log(`\n${property.name} (${property.assetType}, ${property.physical.rentableSF.value.toLocaleString('en-US')} RSF)`)
console.log(`As of ${asOf}; analysis starts ${result.assumptions.acquisition.analysisStartDate}`)
console.log(`${setSummary(setName, Object.keys(edits).length)}${scenario === 'base' ? '\n' : ''}`)
if (scenario !== 'base') {
  console.log(`Scenario: ${SCENARIO_LABELS[scenario]}, price held at Base`)
  for (const c of scenarioChanges(base, scenario, edits)) console.log(`  - ${c}`)
  console.log('')
}
console.log(toTable(result))
console.log('\nMetrics')
const width = Math.max(...metricRows(result).map(([label]) => label.length)) + 2
for (const [label, value] of metricRows(result)) console.log(`  ${label.padEnd(width)}${value}`)
console.log('\nWarnings')
for (const w of result.warnings) console.log(`  - ${w}`)
if (!result.warnings.length) console.log('  (none)')
console.log('\nSensitivity warnings')
for (const w of sensitivityWarnings) console.log(`  - ${w}`)
if (!sensitivityWarnings.length) console.log('  (none)')

const cmp = scenarioComparison(property, asOf, edits)
if (cmp.status === 'ok') {
  console.log('\nScenarios')
  const cell = (s: Scenario, row: (typeof cmp.rows)[number]) => {
    const c = row.cells[s]
    return c.vsBase && c.vsBase.display !== 'no change' ? `${c.display}  ${c.vsBase.display}` : c.display
  }
  const table = [['', ...SCENARIOS.map((s) => SCENARIO_LABELS[s])], ...cmp.rows.map((row) => [row.label, ...SCENARIOS.map((s) => cell(s, row))])]
  const widths = table[0].map((_, j) => Math.max(...table.map((r) => r[j].length)) + 2)
  for (const r of table) console.log(`  ${r.map((x, j) => (j === 0 ? x.padEnd(widths[j]) : x.padStart(widths[j]))).join('')}`)
  for (const s of ['downside', 'upside'] as const) {
    const items = cmp.presets[s].filter((p) => p.delta.value !== 0)
    console.log(`  ${SCENARIO_LABELS[s]}: ${items.map((p) => `${p.label.toLowerCase()} ${p.display}${p.edited ? ' (yours)' : ''}`).join(' · ') || 'no changes'}`)
  }
  for (const n of cmp.notes) console.log(`  ${n}`)
} else {
  console.log(`\nScenarios: ${cmp.reason}`)
}

// Samples: docs/underwriting/<id>.json and docs/underwriting-<id>.csv.
// Imported deals: private-deals/<id>/underwriting.json and underwriting.csv.
// A Downside or Upside run adds "--downside"/"--upside" before the extension.
const dir = outputDir(property)
const isDeal = property.importedFrom !== undefined
const suffix = scenario === 'base' ? '' : `--${scenario}`
const out = json
  ? resolve(dir, isDeal ? `underwriting${suffix}.json` : `underwriting/${property.id}${suffix}.json`)
  : resolve(dir, isDeal ? `underwriting${suffix}.csv` : `underwriting-${property.id}${suffix}.csv`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, json ? JSON.stringify(analystExport(property, asOf, result, { name: setName, edits }), null, 2) + '\n' : toCSV(result, property.name))
console.log(`\nWrote ${out}`)
