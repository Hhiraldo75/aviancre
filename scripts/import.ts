/**
 * Import a rent roll (CSV or Excel .xlsx, in the `npm run rent-roll` export
 * format), validate it, and save the deal as private-deals/<id>.json for
 * `npm run underwrite` and /underwriting-analyst.
 *
 *   npm run import -- <file> [--asset-type office] [--class B] [--submarket downtown] [--address "1 Main St"]
 *
 * The flags fill in (or override) the file's property block.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { SUBMARKETS } from '../src/data/submarkets'
import { dealFile } from '../src/lib/importedDeals'
import { todayISO } from '../src/lib/metrics'
import { readRentRollFile } from '../src/lib/rentRollFile'
import { BUILDING_CLASSES, IMPORT_ASSET_TYPES, parseRentRoll, type DealDetails, type ImportIssue } from '../src/lib/rentRollImport'
import type { AssetType, BuildingClass, SubmarketId } from '../src/types'
import { dealPath } from './deals'
import { PRIVATE_DIR } from './privateDeals'

const USAGE =
  'Usage: npm run import -- <file.csv|file.xlsx> [--asset-type office|retail|industrial|mixed-use] [--class A|B|C] [--submarket <id>] [--address "…"]'
const VALUE_FLAGS = ['asset-type', 'class', 'submarket', 'address']

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const isFlagValue = (i: number) => VALUE_FLAGS.some((f) => args[i - 1] === `--${f}`)
const unknown = args.find((a) => a.startsWith('--') && !VALUE_FLAGS.includes(a.slice(2)))
if (unknown) fail(`Unknown option "${unknown}".\n${USAGE}`)
const file = args.find((a, i) => !a.startsWith('--') && !isFlagValue(i))
if (!file) fail(USAGE)
if (!existsSync(file)) fail(`No such file: ${file}`)

const details: DealDetails = { address: flag('address') }
const assetType = flag('asset-type')
if (assetType !== undefined) {
  if (!(IMPORT_ASSET_TYPES as string[]).includes(assetType)) fail(`--asset-type must be one of: ${IMPORT_ASSET_TYPES.join(', ')}.`)
  details.assetType = assetType as AssetType
}
const cls = flag('class')?.toUpperCase()
if (cls !== undefined) {
  if (!(BUILDING_CLASSES as string[]).includes(cls)) fail('--class must be A, B or C.')
  details.buildingClass = cls as BuildingClass
}
const submarket = flag('submarket')
if (submarket !== undefined) {
  if (!(submarket in SUBMARKETS)) fail(`--submarket must be one of: ${Object.keys(SUBMARKETS).join(', ')}.`)
  details.submarket = submarket as SubmarketId
}

const fileName = basename(file)
const grid = await readRentRollFile(fileName, new Uint8Array(readFileSync(file))).catch((err: Error) => fail(err.message))
const today = todayISO()
const result = parseRentRoll(grid, { fileName, asOf: today, details, importedAt: today })

const s = result.summary
const sf = (n: number) => n.toLocaleString('en-US')
console.log(`\n${s.name || fileName}`)
console.log(
  `  ${s.leases} leases (${sf(s.leasedSF)} SF), ${s.vacancies} vacant suites (${sf(s.vacantSF)} SF), rentable ${s.rentableSF === null ? '?' : sf(s.rentableSF)} SF`,
)

const line = (i: ImportIssue) => `  - ${i.row !== undefined ? `Row ${i.row}${i.column ? ` (${i.column})` : ''}: ` : ''}${i.message}`
const errors = result.issues.filter((i) => i.severity === 'error')
const warnings = result.issues.filter((i) => i.severity === 'warning')
if (warnings.length) console.log(`\nWarnings (${warnings.length})\n${warnings.map(line).join('\n')}`)
if (errors.length || !result.property) {
  console.error(`\nErrors (${errors.length})\n${errors.map(line).join('\n')}`)
  console.error(
    '\nNothing was saved. Fix the file and import again' +
      (errors.some((e) => /choose one when importing/.test(e.message)) ? ', or pass --asset-type, --class and --submarket.' : '.'),
  )
  process.exit(1)
}

const property = result.property
const out = dealPath(property.id)
const replaced = existsSync(out)
mkdirSync(resolve(PRIVATE_DIR), { recursive: true })
writeFileSync(out, JSON.stringify(dealFile(property), null, 2) + '\n')
console.log(`\n${replaced ? 'Replaced' : 'Wrote'} ${out}`)
if (relative(resolve(PRIVATE_DIR), resolve(file)).startsWith('..') && !property.isSample) {
  console.log(`Note: ${file} is outside ${PRIVATE_DIR}/. Keep real rent rolls in ${PRIVATE_DIR}/ so Git never picks them up.`)
}
console.log(`\nDeal id: ${property.id}\nNext:    npm run underwrite -- ${property.id} [--json]`)
