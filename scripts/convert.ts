/**
 * Convert a rent roll in another layout (a Yardi "Rent Roll with Lease
 * Charges", or a table of units with a header row) into our unit rent roll CSV,
 * checked against the file's own totals, for `npm run import`.
 *
 *   npm run convert -- <file.csv|file.xlsx> [--name "Property name"] [--allow-mismatch] [--dump]
 *
 * Writes private-deals/<file>-unit-rent-roll.csv (next to the file when it is
 * already under private-deals/). Nothing is written while anything blocks, or
 * when a total doesn't match the file unless --allow-mismatch. Saved mappings
 * from the app (Download presets file) are read from
 * private-deals/rent-roll-presets.json. --dump prints the file's cells with row
 * numbers and converts nothing (for /convert-rent-roll).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { todayISO } from '../src/lib/metrics'
import { text, type Cell } from '../src/lib/rentRollCells'
import {
  conversionCSV,
  conversionGrid,
  convertRentRoll,
  detectLayout,
  FORMAT_LABELS,
  formatTotal,
  presetsFromFile,
  totalsMismatches,
  type RentRollPreset,
} from '../src/lib/rentRollConvert'
import { readRentRollFile } from '../src/lib/rentRollFile'
import { parseRentRoll, type ImportIssue } from '../src/lib/rentRollImport'
import { PRIVATE_DIR } from './privateDeals'

const USAGE = 'Usage: npm run convert -- <file.csv|file.xlsx> [--name "Property name"] [--allow-mismatch] [--dump]'
const VALUE_FLAGS = ['name']
const BOOL_FLAGS = ['allow-mismatch', 'dump']
const PRESETS_PATH = join(PRIVATE_DIR, 'rent-roll-presets.json')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const unknown = args.find((a) => a.startsWith('--') && ![...VALUE_FLAGS, ...BOOL_FLAGS].includes(a.slice(2)))
if (unknown) fail(`Unknown option "${unknown}".\n${USAGE}`)
const file = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.some((f) => args[i - 1] === `--${f}`))
if (!file) fail(USAGE)
if (!existsSync(file)) fail(`No such file: ${file}`)

const grid = await readRentRollFile(basename(file), new Uint8Array(readFileSync(file))).catch((err: Error) => fail(err.message))

if (args.includes('--dump')) {
  const width = String(grid.length).length
  grid.forEach((row, i) => {
    const cells = row.map((c: Cell) => text(c))
    while (cells.length && !cells[cells.length - 1]) cells.pop()
    if (cells.length) console.log(`${String(i + 1).padStart(width)} | ${cells.join(' | ')}`)
  })
  process.exit(0)
}

const layout = detectLayout(grid)
if (layout === 'ours') {
  console.log(`${file} is already an AVIANCRE rent roll. Import it directly: npm run import -- ${file}`)
  process.exit(0)
}

let presets: RentRollPreset[] = []
if (existsSync(PRESETS_PATH)) {
  presets = presetsFromFile(JSON.parse(readFileSync(PRESETS_PATH, 'utf8'))) ?? fail(`${PRESETS_PATH} is not a presets file. Download it again from the app.`)
}

const today = todayISO()
const c = convertRentRoll(grid, { presets, today, name: flag('name') })

// ---- report ----
const pad = (s: string, n: number) => s.padEnd(n)
const padL = (s: string, n: number) => s.padStart(n)
console.log(`\n${file}`)
console.log(`  ${FORMAT_LABELS[c.format]}${c.headerRow !== null ? `, header on row ${c.headerRow}` : ''}${c.presetName ? `, preset "${c.presetName}"` : ''}`)
if (c.name) console.log(`  ${c.name}${c.asOf ? `, as of ${c.asOf}` : ''}`)

if (c.fields.length) {
  console.log('\nColumn mapping')
  for (const f of c.fields) {
    const where = f.column === null ? '(not in file)' : `${c.columns[f.column] || '(no header)'} [column ${f.column + 1}]`
    console.log(`  ${pad(f.label + (f.required ? ' *' : ''), 30)} ${where}${f.provenance ? `  (${f.provenance})` : ''}`)
  }
}
if (c.chargeCodes.length) {
  console.log('\nCharge codes (monthly, occupied units)')
  for (const x of c.chargeCodes) console.log(`  ${pad(x.code, 14)} ${padL(formatTotal('usd', x.total), 14)}  ${x.use}  (${x.provenance})`)
}
if (c.statusValues.length) {
  console.log('\nStatus values')
  for (const s of c.statusValues) console.log(`  ${pad(`${s.value || '(blank)'} ×${s.count}`, 24)} ${s.choice ?? 'NOT CLASSIFIED'}${s.provenance ? `  (${s.provenance})` : ''}`)
}
if (c.plans.length) {
  console.log('\nFloor plans (rename in the app, or edit the CSV)')
  for (const p of c.plans) {
    const codes = p.codes.length > 6 ? `${p.codes.slice(0, 6).join(', ')} +${p.codes.length - 6}` : p.codes.join(', ')
    console.log(`  ${pad(p.name, 20)} ${padL(String(p.units), 4)} units  ${padL(p.market === null ? '?' : formatTotal('usd', p.market), 12)}${codes ? `  ${codes}` : ''}`)
  }
}
if (c.totals.length) {
  console.log('\nTotals check')
  console.log(`  ${pad('', 32)} ${padL('Converted', 16)} ${padL('File', 16)}`)
  for (const t of c.totals) {
    const check = t.match === null ? 'not in file' : t.match ? 'match' : 'MISMATCH'
    console.log(`  ${pad(t.label, 32)} ${padL(formatTotal(t.kind, t.converted), 16)} ${padL(t.file === null ? '—' : formatTotal(t.kind, t.file), 16)}  ${check}`)
  }
}
if (c.flags.length) console.log(`\nInferred or worth checking (${c.flags.length})\n${c.flags.map((x) => `  - ${x}`).join('\n')}`)

if (c.blockers.length) {
  console.error(`\nTo fix (${c.blockers.length})\n${c.blockers.map((x) => `  - ${x}`).join('\n')}`)
  console.error(
    '\nNothing was written. Map this layout in the app (Import rent roll), save it as a preset and download the presets file to ' +
      `${PRESETS_PATH}, or convert it with /convert-rent-roll in Claude Code.`,
  )
  process.exit(1)
}
const mismatches = totalsMismatches(c)
if (mismatches.length && !args.includes('--allow-mismatch')) {
  console.error(`\n${mismatches.length} total${mismatches.length === 1 ? '' : 's'} don't match the file. Nothing was written; check them, then re-run with --allow-mismatch.`)
  process.exit(1)
}

// ---- write and validate ----
const inPrivate = !relative(resolve(PRIVATE_DIR), resolve(file)).startsWith('..')
const out = join(inPrivate ? dirname(file) : PRIVATE_DIR, `${basename(file, extname(file))}-unit-rent-roll.csv`)
mkdirSync(dirname(out), { recursive: true })
const replaced = existsSync(out)
writeFileSync(out, conversionCSV(c))
console.log(`\n${replaced ? 'Replaced' : 'Wrote'} ${out}`)

const result = parseRentRoll(conversionGrid(c), { fileName: basename(out), asOf: today, importedAt: today })
const pending = (i: ImportIssue) => /choose one when importing/.test(i.message)
const errors = result.issues.filter((i) => i.severity === 'error' && !pending(i))
const warnings = result.issues.filter((i) => i.severity === 'warning')
const line = (i: ImportIssue) => `  - ${i.row !== undefined ? `Row ${i.row}${i.column ? ` (${i.column})` : ''}: ` : ''}${i.message}`
console.log(`\nImport check: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`)
if (errors.length) console.error(errors.map(line).join('\n'))
if (warnings.length) console.log(warnings.slice(0, 10).map(line).join('\n') + (warnings.length > 10 ? `\n  … and ${warnings.length - 10} more` : ''))
console.log(`\nNext: npm run import -- ${out} --class <A|B|C> --submarket <id>`)
if (errors.length) process.exit(1)
