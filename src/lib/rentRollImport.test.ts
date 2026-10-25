import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import type { Property } from '../types'
import atwellsDoc from '../../docs/atwells-rent-roll.csv?raw'
import atwellsFixture from './underwriting/__fixtures__/atwells-benchmark.csv?raw'
import atwellsValidation from './underwriting/__fixtures__/atwells-validation.assumptions.json'
import westminsterFixture from './underwriting/__fixtures__/westminster-benchmark.csv?raw'
import westminsterValidation from './underwriting/__fixtures__/westminster-validation.assumptions.json'
import { parseCSV } from './csv'
import { readRentRollFile } from './rentRollFile'
import { parseRentRoll, parseDate, parseNumber, type Cell, type ImportIssue } from './rentRollImport'
import { assumptionsFor } from './underwriting/edits'
import { goldenChecks } from './underwriting/goldenChecks'
import { underwrite } from './underwriting/underwrite'
import { rentRollCSV } from './underwriting/report'

const AS_OF = '2026-10-04'
const byId = (id: string) => {
  const p = SAMPLE_PROPERTIES.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
const ATWELLS = byId('sample-atwells-retail-row')
const WESTMINSTER = byId('sample-westminster-tower')

const importCSV = (csv: string, details = {}) => parseRentRoll(parseCSV(csv), { fileName: 'test.csv', asOf: AS_OF, details })
const loaded = (r: ReturnType<typeof parseRentRoll>): Property => {
  if (!r.property) throw new Error(`import failed: ${JSON.stringify(r.issues)}`)
  return r.property
}

/** An .xlsx built from a CSV the way Excel would save it: numbers as numbers, dates as date cells. */
function xlsxFrom(csv: string): Uint8Array {
  const sheet: XLSX.WorkSheet = {}
  const rows = parseCSV(csv)
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === '') return
      const ref = XLSX.utils.encode_cell({ r, c })
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const serial = Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 86_400_000 + 25569
        sheet[ref] = { t: 'n', v: serial, z: 'm/d/yyyy' }
      } else if (/^-?\d+(\.\d+)?$/.test(v)) sheet[ref] = { t: 'n', v: Number(v) }
      else sheet[ref] = { t: 's', v }
    }),
  )
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(...rows.map((r) => r.length)) - 1 } })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Rent roll')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

const exported = importCSV(rentRollCSV(ATWELLS))
const fromDoc = importCSV(atwellsDoc)
const fromXlsx = parseRentRoll(await readRentRollFile('atwells.xlsx', xlsxFrom(atwellsDoc)), { fileName: 'atwells.xlsx', asOf: AS_OF })

/** An imported deal run at the validation set its golden fixture was matched with (the set's id is the sample's). */
const atValidation = (p: Property, set: { changes: Record<string, number> }) => underwrite(p, AS_OF, assumptionsFor(p, AS_OF, set.changes))

describe('Atwells golden benchmark, from an imported rent roll', () => {
  it('imports the export with no issues', () => {
    expect(exported.issues).toEqual([])
    expect(fromDoc.issues).toEqual([])
    expect(fromXlsx.issues).toEqual([])
  })
  describe('exported in memory', () => goldenChecks(atValidation(loaded(exported), atwellsValidation), atwellsFixture))
  describe('from docs/atwells-rent-roll.csv', () => goldenChecks(atValidation(loaded(fromDoc), atwellsValidation), atwellsFixture))
  describe('from an Excel .xlsx', () => goldenChecks(atValidation(loaded(fromXlsx), atwellsValidation), atwellsFixture))

  it('reproduces the sample run exactly', () => {
    const { generatedAt: _a, propertyId: _p, ...sample } = underwrite(ATWELLS, AS_OF)
    const { generatedAt: _b, propertyId: _q, ...imported } = underwrite(loaded(exported), AS_OF)
    expect(imported).toEqual(sample)
  })
})

describe('Westminster golden benchmark, from an imported rent roll', () => {
  const r = importCSV(rentRollCSV(WESTMINSTER))
  it('imports with no issues', () => expect(r.issues).toEqual([]))
  goldenChecks(atValidation(loaded(r), westminsterValidation), westminsterFixture)
})

describe('an imported deal', () => {
  const p = loaded(exported)
  it('is a private deal named from the file, keeping the sample flag from the title', () => {
    expect(p.id).toBe('deal-atwells-retail-row-sample')
    expect(p.name).toBe('Atwells Retail Row (Sample)')
    expect(p.isSample).toBe(true)
    expect(p.importedFrom).toEqual({ fileName: 'test.csv', importedAt: AS_OF })
    expect(p).toMatchObject({ assetType: 'retail', buildingClass: 'B', location: { submarket: 'federal-hill', address: '245 Atwells Ave' } })
  })
  it('marks imported values ACT and everything else EST', () => {
    expect(p.physical.rentableSF).toMatchObject({ value: 14_400, source: 'imported' })
    if (p.rentRoll.kind !== 'commercial') throw new Error('expected commercial')
    expect(p.rentRoll.leases.every((l) => l.source === 'imported' && l.sourceName === 'Imported rent roll (test.csv)')).toBe(true)
    expect(p.market.marketRent.source).toBe('estimated')
    expect(p.physical.grossBuildingSF.source).toBe('estimated')
    expect(p.physical.floors.source).toBe('estimated')
    expect(underwrite(p, AS_OF).assumptions.exit.exitCapRate.source).toBe('estimated')
  })
  it('reads the optional columns', () => {
    if (p.rentRoll.kind !== 'commercial') throw new Error('expected commercial')
    const casa = p.rentRoll.leases.find((l) => l.tenantName.startsWith('Casa'))!
    expect(casa.renewalOptions).toEqual([{ termMonths: 60, rentBasis: 'fixed', value: 30 }])
    expect(casa.recovery).toEqual({ method: 'net', adminFeePct: 0.1 })
    const w = loaded(importCSV(rentRollCSV(WESTMINSTER)))
    if (w.rentRoll.kind !== 'commercial') throw new Error('expected commercial')
    expect(w.rentRoll.leases.find((l) => l.tenantName.startsWith('Harborline'))!.freeRentMonths).toBe(6)
  })
  it('reads a base-year expense amount, rent steps, an expense stop and a %-of-market option', () => {
    const csv = edit(rentRollCSV(WESTMINSTER), (g) => {
      const weybridge = leaseRow(g, 'Weybridge')
      set(g, weybridge, 'Base-year expense amount ($/yr)', '3100000')
      set(g, weybridge, 'Renewal option rent ($/SF/yr)', '95% of market')
      const kestrel = leaseRow(g, 'Kestrel')
      set(g, kestrel, 'Escalation type', 'steps')
      set(g, kestrel, 'Escalation value', '2024-03-01: $25.00; 2026-03-01: $26.50')
      set(g, kestrel, 'Recovery method', 'expense-stop ($9.5/SF)')
    })
    const w = loaded(importCSV(csv))
    if (w.rentRoll.kind !== 'commercial') throw new Error('expected commercial')
    const [weybridge, , , kestrel] = w.rentRoll.leases
    expect(weybridge.recovery).toEqual({ method: 'base-year', baseYear: 2019, baseYearExpenses: 3_100_000 })
    expect(weybridge.renewalOptions).toEqual([{ termMonths: 60, rentBasis: 'percent-of-market', value: 0.95 }])
    expect(kestrel.escalation).toEqual({
      type: 'steps',
      steps: [
        { effectiveDate: '2024-03-01', annualRentPerSF: 25 },
        { effectiveDate: '2026-03-01', annualRentPerSF: 26.5 },
      ],
    })
    expect(kestrel.recovery).toEqual({ method: 'expense-stop', stopPerSF: 9.5 })
    // Exporting the imported deal writes the same rent roll back.
    expect(rentRollCSV(w).split('\n').slice(10)).toEqual(csv.split('\n').slice(10))
  })
  it('accepts dates and numbers as Excel re-saves a CSV', () => {
    expect(parseDate('3/1/2015')).toBe('2015-03-01')
    expect(parseDate('2/28/30')).toBe('2030-02-28')
    expect(parseDate(42064)).toBe('2015-03-01')
    expect(parseNumber('$3,400')).toBe(3400)
    expect(parseNumber('3%')).toBeCloseTo(0.03, 12)
    const csv = edit(atwellsDoc, (g) => {
      const casa = leaseRow(g, 'Casa')
      set(g, casa, 'Start', '3/1/2015')
      set(g, casa, 'SF', '"3,400"')
      set(g, casa, 'Escalation value', '3%')
    })
    expect(loaded(importCSV(csv)).rentRoll).toEqual(loaded(fromDoc).rentRoll)
  })
})

// ---------- validation ----------

/** Edits the Atwells grid in place, then writes it back as CSV (cells are written raw). */
function edit(csv: string, f: (grid: string[][]) => void): string {
  const g = parseCSV(csv)
  f(g)
  return g.map((r) => r.join(',')).join('\n') + '\n'
}
const headerRow = (g: string[][], section: 'Leases' | 'Vacant suites') => g.findIndex((r) => r[0] === section) + 1
const leaseRow = (g: string[][], tenant: string) => g.findIndex((r) => r[0].startsWith(tenant)) + 1
const set = (g: string[][], row: number, column: string, value: string, section: 'Leases' | 'Vacant suites' = 'Leases') => {
  g[row - 1][g[headerRow(g, section)].indexOf(column)] = value
}

const errorsOf = (csv: string, details = {}) => importCSV(csv, details).issues.filter((i) => i.severity === 'error')
/** Atwells' 1-based row numbers (grid index + 1): 1 title, 2 rentable SF, 4–8 property, 10 Leases, 11 header, 12–15 leases, 17 Vacant suites, 18 header, 19 suite 200. */
const ROW = { rsf: 2, assetType: 5, submarket: 7, address: 8, leaseHeader: 11, casa: 12, hill: 13, vacantHeader: 18, suite200: 19 }

function expectOnly(issues: ImportIssue[], expected: Omit<Partial<ImportIssue>, 'message'> & { message: RegExp }) {
  expect(issues).toHaveLength(1)
  const { message, ...rest } = expected
  expect(issues[0]).toMatchObject({ ...rest })
  expect(issues[0].message).toMatch(message)
}

describe('rent roll validation: errors stop the import', () => {
  const bad = (f: (g: string[][]) => void) => {
    const r = importCSV(edit(atwellsDoc, f))
    expect(r.property).toBeNull()
    return r.issues.filter((i) => i.severity === 'error')
  }

  it('a missing required column', () => {
    const errors = bad((g) => (g[ROW.leaseHeader - 1][g[ROW.leaseHeader - 1].indexOf('Lease type')] = 'Type'))
    expectOnly(errors, { row: ROW.leaseHeader, message: /Leases: missing required column "Lease type"/ })
  })
  it('several missing columns in the vacant suites table', () => {
    const errors = bad((g) => (g[ROW.vacantHeader - 1] = ['Space', 'Area']))
    expectOnly(errors, { row: ROW.vacantHeader, message: /Vacant suites: missing required columns "Suite", "SF"/ })
  })
  it('an invalid start date', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Start', '2015-02-30')), {
      row: ROW.casa,
      column: 'Start',
      message: /Start "2015-02-30" is not a valid date/,
    })
  })
  it('an invalid end date', () => {
    expectOnly(bad((g) => set(g, ROW.hill, 'End', 'soon')), { row: ROW.hill, column: 'End', message: /End "soon" is not a valid date/ })
  })
  it('an end on or before the start', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'End', '2015-03-01')), {
      row: ROW.casa,
      column: 'End',
      message: /End \(2015-03-01\) must be after Start \(2015-03-01\)/,
    })
  })
  it('a lease SF that is zero, negative or not a number', () => {
    for (const sf of ['0', '-100', 'abc']) {
      expectOnly(bad((g) => set(g, ROW.casa, 'SF', sf)), { row: ROW.casa, column: 'SF', message: new RegExp(`SF must be a positive number, got "${sf}"`) })
    }
  })
  it('a vacant suite SF that is not positive', () => {
    expectOnly(bad((g) => set(g, ROW.suite200, 'SF', '0', 'Vacant suites')), {
      row: ROW.suite200,
      column: 'SF',
      message: /SF must be a positive number/,
    })
  })
  it('a missing or non-positive rentable SF', () => {
    expectOnly(bad((g) => (g[ROW.rsf - 1][0] = 'Rentable SF 0; rents are annual')), { row: ROW.rsf, message: /Rentable SF must be a positive number/ })
    expectOnly(bad((g) => (g[ROW.rsf - 1][0] = 'Notes')), { message: /No rentable SF/ })
  })
  it('an unknown lease type', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Lease type', 'triple net-ish')), {
      row: ROW.casa,
      column: 'Lease type',
      message: /Unknown lease type "triple net-ish"/,
    })
  })
  it('an unknown recovery method, and a base year without its year', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Recovery method', 'pro-rata')), {
      row: ROW.casa,
      column: 'Recovery method',
      message: /Unknown recovery method "pro-rata"/,
    })
    expectOnly(bad((g) => set(g, ROW.casa, 'Recovery method', 'base-year')), { row: ROW.casa, message: /needs the year/ })
  })
  it('an unknown escalation type', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Escalation type', 'CPI')), {
      row: ROW.casa,
      column: 'Escalation type',
      message: /Unknown escalation type "CPI"/,
    })
  })
  it('a percentage typed as a whole number', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Escalation value', '3')), {
      row: ROW.casa,
      column: 'Escalation value',
      message: /looks like a whole percent.*use 0.03 for 3%/,
    })
    expectOnly(bad((g) => set(g, ROW.hill, 'Admin fee', '10')), { row: ROW.hill, column: 'Admin fee', message: /use 0.1 for 10%/ })
  })
  it('a negative rent or a bad optional number', () => {
    expectOnly(bad((g) => set(g, ROW.casa, 'Starting rent ($/SF/yr)', '-24')), { row: ROW.casa, message: /Starting rent must be a number/ })
    expectOnly(bad((g) => set(g, ROW.casa, 'Free rent (months)', 'three')), { row: ROW.casa, message: /Free rent \(months\) must be a number/ })
    expectOnly(bad((g) => set(g, ROW.casa, 'Renewal option rent ($/SF/yr)', 'TBD')), { row: ROW.casa, message: /Renewal option rent must be/ })
  })
  it('a missing section', () => {
    const errors = bad((g) => (g[ROW.vacantHeader - 2][0] = 'Vacancies'))
    expect(errors.map((e) => e.message).join('\n')).toMatch(/No "Vacant suites" section/)
  })
  it('an unknown asset type, class or submarket', () => {
    expectOnly(bad((g) => (g[ROW.assetType - 1][1] = 'hotel')), { row: ROW.assetType, message: /Unknown asset type "hotel"/ })
    expectOnly(bad((g) => (g[ROW.assetType - 1][1] = 'multifamily')), { row: ROW.assetType, message: /Multifamily rent rolls/ })
    expectOnly(bad((g) => (g[ROW.submarket - 1][1] = 'Cranston')), { row: ROW.submarket, message: /Unknown submarket "Cranston"/ })
  })
  it('an explicit choice replaces an invalid file value', () => {
    const csv = edit(atwellsDoc, (g) => (g[ROW.submarket - 1][1] = 'Cranston'))
    const r = importCSV(csv, { submarket: 'federal-hill' })
    expect(r.issues).toEqual([])
    expect(r.fileDetails.submarket).toBeUndefined()
    expect(loaded(r).location.submarket).toBe('federal-hill')
  })
  it('missing deal details, unless supplied at import', () => {
    const noBlock = edit(atwellsDoc, (g) => g.splice(3, 6))
    expect(errorsOf(noBlock).map((e) => e.message)).toEqual([
      expect.stringMatching(/Asset type is missing/),
      expect.stringMatching(/Building class is missing/),
      expect.stringMatching(/Submarket is missing/),
    ])
    const r = importCSV(noBlock, { assetType: 'retail', buildingClass: 'B', submarket: 'federal-hill' })
    expect(r.issues.map((i) => i.severity)).toEqual(['warning']) // no address
    expect(r.fileDetails).toEqual({})
    const { generatedAt: _a, propertyId: _p, ...sample } = underwrite(ATWELLS, AS_OF)
    const { generatedAt: _b, propertyId: _q, ...imported } = underwrite(loaded(r), AS_OF)
    expect(imported).toEqual(sample)
  })
  it('reports every bad row, not just the first', () => {
    const errors = bad((g) => {
      set(g, ROW.casa, 'SF', '0')
      set(g, ROW.hill, 'Lease type', 'gross')
    })
    expect(errors.map((e) => e.row)).toEqual([ROW.casa, ROW.hill])
  })
})

describe('rent roll validation: warnings still allow the import', () => {
  const warned = (f: (g: string[][]) => void) => {
    const r = importCSV(edit(atwellsDoc, f))
    expect(r.property).not.toBeNull()
    return r.issues
  }
  it('leased + vacant SF that differs from rentable SF', () => {
    expectOnly(warned((g) => (g[ROW.rsf - 1][0] = 'Rentable SF 15000; rents are annual $/SF')), {
      severity: 'warning',
      row: ROW.rsf,
      message: /Leased \(10,800 SF\) \+ vacant \(3,600 SF\) = 14,400 SF, but rentable SF is 15,000/,
    })
  })
  it('a duplicate suite', () => {
    expectOnly(warned((g) => set(g, ROW.hill, 'Suite', '101')), { severity: 'warning', row: ROW.hill, message: /Suite "101" also appears on row 12/ })
  })
  it('a lease that already expired', () => {
    expectOnly(warned((g) => set(g, ROW.hill, 'End', '2026-06-30')), { severity: 'warning', row: ROW.hill, message: /expired on 2026-06-30/ })
  })
  it('an unused column', () => {
    expectOnly(warned((g) => (g[ROW.leaseHeader - 1][14] = 'Notes')), { severity: 'warning', row: ROW.leaseHeader, message: /column "Notes" isn't used/ })
  })
  it('no address', () => {
    expectOnly(warned((g) => (g[ROW.address - 1][1] = '')), { severity: 'warning', message: /No address.*Federal Hill/ })
  })
})

describe('rent roll files', () => {
  it('rejects other file types', async () => {
    await expect(readRentRollFile('rent-roll.pdf', new Uint8Array())).rejects.toThrow(/Use .csv or .xlsx/)
  })
  it('reads a CSV with a byte-order mark and CRLF line endings', async () => {
    const bytes = new TextEncoder().encode('﻿' + atwellsDoc.replace(/\n/g, '\r\n'))
    const grid: Cell[][] = await readRentRollFile('atwells.CSV', bytes)
    expect(parseRentRoll(grid, { fileName: 'test.csv', asOf: AS_OF }).property?.rentRoll).toEqual(loaded(fromDoc).rentRoll)
  })
})
