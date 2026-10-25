/**
 * Underwrite one property from the command line and write a CSV for Excel
 * checks, or with --json the machine-readable output the AI analyst reads.
 * Works on sample properties and on deals saved by `npm run import`; a
 * deal's output goes to private-deals/<id>/ instead of docs/.
 *
 *   npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price 4500000]
 *                         [--scenario base|downside|upside] [--t12 file] [--json]
 *
 * --assumptions runs a set exported from Full underwriting > Assumptions;
 * --price is applied on top of it as one more change. --scenario runs the
 * Downside or Upside case of that (with the set's edited presets, if any);
 * its files get a "--downside"/"--upside" suffix so Base files stay as they are.
 * Every run also prints Base, Downside and Upside side by side.
 *
 * --t12 applies a T-12: a CSV/.xlsx statement (mapped automatically) or the
 * mapped T-12 downloaded from the app (.json). private-deals/<id>/t12.json is
 * applied when there is no --t12. Year-1 expenses and other income then come
 * from the T-12, the run prints the T-12 check, and its files get a "--t12"
 * suffix. A T-12 from anywhere but docs/samples/ is treated as real: the
 * output goes to private-deals/<id>/, even for a sample property.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { todayISO } from '../src/lib/metrics'
import { readRentRollFile } from '../src/lib/rentRollFile'
import { parseT12File, periodLabel, withT12 } from '../src/lib/t12'
import { readT12, statementFrom } from '../src/lib/t12Read'
import { toCSV, toTable, underwrite } from '../src/lib/underwriting'
import { analystExport } from '../src/lib/underwriting/analystExport'
import { DEFAULTS_SET, parseAssumptionSetFile, setSummary } from '../src/lib/underwriting/assumptionSets'
import { assumptionsFor, type AssumptionEdits } from '../src/lib/underwriting/edits'
import { SCENARIO_LABELS, SCENARIOS, scenarioChanges, scenarioComparison, withScenario } from '../src/lib/underwriting/scenarios'
import { metricRows } from '../src/lib/underwriting/report'
import { sensitivityGrids } from '../src/lib/underwriting/sensitivity'
import { t12Check } from '../src/lib/underwriting/t12Check'
import type { Property, Scenario, T12Statement } from '../src/types'
import { findProperty, outputDir, propertyList } from './deals'
import { PRIVATE_DIR } from './privateDeals'

const USAGE =
  'Usage: npm run underwrite -- <property-id> [--as-of YYYY-MM-DD] [--assumptions set.json] [--price N] [--scenario base|downside|upside] [--t12 file] [--json]'
/** Flags that take a value; --json takes none. */
const VALUE_FLAGS = ['as-of', 'price', 'assumptions', 'scenario', 't12']

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
const asOf = flag('as-of') ?? todayISO()
const t12Path = flag('t12') ?? (existsSync(resolve(PRIVATE_DIR, id, 't12.json')) ? `${PRIVATE_DIR}/${id}/t12.json` : undefined)
const t12 = t12Path === undefined ? undefined : await loadT12(t12Path, found ?? fail(`Unknown property "${id}".`))
const property: Property = t12 ? withT12(found!, t12) : (found ?? fail(`Unknown property "${id}".`))
/** Only the fictional sample T-12s in docs/samples/ may write into docs/. */
const t12IsReal = t12Path !== undefined && relative(resolve('docs/samples'), resolve(t12Path)).startsWith('..')
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail(`--as-of must be YYYY-MM-DD, got "${asOf}".`)
const price = flag('price')
const scenarioFlag = flag('scenario') ?? 'base'
if (!(SCENARIOS as readonly string[]).includes(scenarioFlag)) fail(`--scenario must be base, downside or upside, got "${scenarioFlag}".`)
const scenario = scenarioFlag as Scenario

// The assumption set: Defaults, or an exported set file, plus --price as one more change.
let setName = DEFAULTS_SET
let edits: AssumptionEdits = {}
const setNotices: string[] = []
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
  setNotices.push(...(parsed.notices ?? []))
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
for (const n of setNotices) console.log(`Note: ${n}`)
const base = assumptionsFor(property, asOf, edits)
const result = underwrite(property, asOf, withScenario(base, scenario, edits))
const sensitivityWarnings = sensitivityGrids(property, asOf, result.assumptions).warnings

console.log(`\n${property.name} (${property.assetType}, ${property.physical.rentableSF.value.toLocaleString('en-US')} RSF)`)
console.log(`As of ${asOf}; analysis starts ${result.assumptions.acquisition.analysisStartDate}`)
if (t12) console.log(`T-12: ${t12Path} (${periodLabel(t12)}), ${t12.isSample ? 'fictional sample data' : 'actuals'}; Year-1 expenses and other income come from it`)
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

const check = t12Check(property, asOf, edits, { reason: 'not looked up on the command line (the app compares it for placed deals)' })
if (check) {
  console.log(`\nT-12 check (${check.period}, Base case)`)
  const table = [['', 'T-12', 'UW Year 1', 'NOI effect'], ...check.rows.map((r) => [r.label, r.t12.display, r.underwritten.display, r.noiEffect.display])]
  const widths = table[0].map((_, j) => Math.max(...table.map((r) => r[j].length)) + 2)
  for (const r of table) console.log(`  ${r.map((x, j) => (j === 0 ? x.padEnd(widths[j]) : x.padStart(widths[j]))).join('')}`)
  if (check.reportedNOI?.note) console.log(`  ${check.reportedNOI.note}`)
  console.log(`  T-12 lines grown ${check.growth}.`)
  console.log(`  Other income: T-12 ${check.otherIncome.t12Year1.display} (used) · ${property.rentRoll.kind === 'multifamily' ? 'rent roll' : 'without T-12'} ${check.otherIncome.rentRoll.display}`)
  console.log(`  Management fee: T-12 ${check.managementFee.t12.display} (${check.managementFee.t12PctOfEGI.display} of EGI) · model ${check.managementFee.modelPct.display}: ${check.managementFee.underwritten.display}`)
  console.log(`  Property taxes vs tax roll: ${check.tax.status === 'ok' ? `${check.tax.t12.display} vs ${check.tax.taxRoll.display}` : check.tax.reason}`)
  console.log(`  Expense ratio: T-12 ${check.expenseRatio.t12.display} · UW ${check.expenseRatio.underwritten.display} · benchmark ${check.expenseRatio.benchmark.display} (estimate)`)
  console.log(`  Opex${check.perBasis.basis}: T-12 ${check.perBasis.t12.display} · UW ${check.perBasis.underwritten.display} · benchmark ${check.perBasis.benchmark.display} (estimate)`)
  console.log(`  Below NOI: ${check.belowNOI.t12.map((x) => `${x.label} ${x.amount.display}`).join(' · ')}`)
  console.log('  Effect of the T-12 (without → with):')
  for (const e of check.effect) console.log(`    ${e.label.padEnd(32)}${e.without.display.padStart(14)} → ${e.with.display.padStart(14)}  ${e.change.display}`)
  for (const f of check.flags) console.log(`  FLAG: ${f}`)
}

// Samples: docs/underwriting/<id>.json and docs/underwriting-<id>.csv.
// Imported deals: private-deals/<id>/underwriting.json and underwriting.csv.
// A Downside or Upside run adds "--downside"/"--upside" before the extension, a T-12 run "--t12".
// A sample with a real T-12 writes to private-deals/<id>/ like a deal.
const isDeal = property.importedFrom !== undefined || t12IsReal
const dir = isDeal ? resolve(PRIVATE_DIR, property.id) : outputDir(property)
const suffix = `${scenario === 'base' ? '' : `--${scenario}`}${t12 ? '--t12' : ''}`
const out = json
  ? resolve(dir, isDeal ? `underwriting${suffix}.json` : `underwriting/${property.id}${suffix}.json`)
  : resolve(dir, isDeal ? `underwriting${suffix}.csv` : `underwriting-${property.id}${suffix}.csv`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, json ? JSON.stringify(analystExport(property, asOf, result, { name: setName, edits }), null, 2) + '\n' : toCSV(result, property.name))
console.log(`\nWrote ${out}`)

/** A T-12 for the property: a mapped .json from the app, or a CSV/.xlsx statement mapped automatically. */
async function loadT12(path: string, p: Property): Promise<T12Statement> {
  if (!existsSync(path)) fail(`No such T-12 file: ${path}`)
  if (path.toLowerCase().endsWith('.json')) {
    let json: unknown
    try {
      json = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      fail(`${path} is not valid JSON.`)
    }
    const parsed = parseT12File(json, p.id)
    if ('error' in parsed) fail(`${path} can't be used: ${parsed.error}`)
    return parsed.statement
  }
  const grid = await readRentRollFile(path, new Uint8Array(readFileSync(path)), 'T-12').catch((err: Error) => fail(err.message))
  const r = readT12(grid, { kind: p.rentRoll.kind })
  if (r.blockers.length) fail(`${path} can't be read as a T-12:\n${r.blockers.map((b) => `  - ${b}`).join('\n')}`)
  const off = r.totals.filter((t) => t.match === false)
  if (off.length) {
    fail(
      `${path}: the lines don't match the file's totals (${off.map((t) => `${t.label} ${t.mapped} vs ${t.file}`).join('; ')}).\n` +
        'Map it in the app (Investment view > Load T-12), download the mapped T-12 and pass that .json instead.',
    )
  }
  for (const f of r.flags) console.log(`T-12 note: ${f}`)
  return statementFrom(r, { fileName: path.split('/').pop()!, importedAt: todayISO() })
}
