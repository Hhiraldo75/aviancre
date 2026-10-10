import { describe, expect, it } from 'vitest'
import fernhillDoc from '../../docs/samples/fernhill-commons-unit-rent-roll.csv?raw'
import { parseCSV } from './csv'
import {
  conversionCSV,
  conversionGrid,
  convertRentRoll,
  detectLayout,
  presetFrom,
  presetsFile,
  presetsFromFile,
  totalsMismatches,
  withPreset,
  type Conversion,
  type ConvertOptions,
} from './rentRollConvert'
import type { Cell } from './rentRollCells'
import { parseRentRoll } from './rentRollImport'

const AS_OF = '2026-10-04'
const DETAILS = { buildingClass: 'B', submarket: 'olneyville' } as const
const validate = (c: Conversion) => parseRentRoll(conversionGrid(c), { fileName: 'converted.csv', asOf: AS_OF, details: DETAILS })
const errorsOf = (c: Conversion) => validate(c).issues.filter((i) => i.severity === 'error')
const total = (c: Conversion, label: string) => c.totals.find((t) => t.label.startsWith(label))!
const field = (c: Conversion, key: string) => {
  const f = c.fields.find((x) => x.key === key)!
  return { column: f.column === null ? null : c.columns[f.column], provenance: f.provenance }
}

// ---- a small Yardi "Rent Roll with Lease Charges" ----
const charge = (code: string, amount: number): Cell[] => ['', '', '', '', '', '', code, amount]
const blockTotal = (amount: number): Cell[] => ['', '', '', '', '', '', 'Total', amount]
const H1 = ['Unit', 'Unit Type', 'Unit', 'Resident', 'Name', 'Market', 'Charge', 'Amount', 'Resident', 'Other', 'Move In', 'Lease', 'Move Out', 'Balance']
const H2 = ['', '', ' Sq Ft', '', '', ' Rent', ' Code', '', ' Deposit', ' Deposit', '', ' Expiration', '', '']
function yardi(edit: (rows: Cell[][]) => void = () => {}): Cell[][] {
  const rows: Cell[][] = [
    ['Rent Roll with Lease Charges'],
    ['Test Gardens (fictional sample data)'],
    ['As Of = 9/30/2026'],
    // Copies, so an edit to one grid's header doesn't leak into later tests.
    [...H1],
    [...H2],
    ['Current/Notice/Vacant Residents'],
    [101, 'tg1a', 600, 't001', 'Resident', 1200, 'rent', 1100, 150, 0, '2026-01-01', '2026-12-31', '', 0],
    charge('petrent', 25),
    blockTotal(1125),
    [],
    [102, 'tg1b', 600, 'VACANT', 'VACANT', 1200, '', 0, 0, 0, '', '', '', 0],
    blockTotal(0),
    [],
    [103, 'tg2a', 850, 't002', 'Resident', 1500, 'storage', 40, 400, 0, '2026-03-01', '2027-02-28', '2026-11-30', 250],
    charge('rent', 1450),
    blockTotal(1490),
    [],
    [104, 'tg2a', 850, 'MODEL', 'MODEL', 1500, '', 0, 0, 0, '', '', '', 0],
    blockTotal(0),
    [],
    ['Future Residents/Applicants'],
    [102, 'tg1b', 600, 't003', 'Applicant', 1200, '', 0, 0, 0, '2026-10-15', '2027-10-14', '', -200],
    blockTotal(0),
    [],
    ['', '', '', 'Total', 'Test Gardens', 5400, '', 2615, 550, 0, '', '', '', 50],
    [],
    ['Summary Groups', '', '', '', '', 'Square', 'Market', 'Actual', 'Security', 'Other', '# Of', '% Unit', '% Sqft', 'Balance'],
    ['', '', '', '', '', 'Footage', 'Rent', 'Rent', 'Deposit', 'Deposits', 'Units', 'Occupancy', 'Occupied', ''],
    ['Current/Notice/Vacant Residents', '', '', '', '', '', '', 2615, 550, 0, '', '', '', 250],
    ['Future Residents/Applicants', '', '', '', '', '', '', 0, 0, 0, '', '', '', -200],
    ['Occupied Units', '', '', '', '', 1450, 2700, '', '', '', 2, 50, 50, ''],
    ['Total Non Rev Units', '', '', '', '', 850, 1500, '', '', '', 1, 25, 29.31, ''],
    ['Total Vacant Units', '', '', '', '', 600, 1200, '', '', '', 1, 25, 20.69, ''],
    ['Totals:', '', '', '', '', 2900, 5400, 2615, 550, 0, 4, 100, 100, 50],
    [],
    ['Summary of Charges by Charge Code'],
    ['(Current/Notice Residents Only)'],
    ['Charge Code', '', '', 'Amount'],
    ['rent', '', '', 2550],
    ['petrent', '', '', 25],
    ['storage', '', '', 40],
    ['Total', '', '', 2615],
  ]
  edit(rows)
  return rows
}
const MODEL_VACANT: ConvertOptions = { statusValues: { MODEL: 'vacant' } }
const rowOf = (rows: Cell[][], unit: number, from = 0) => rows.findIndex((r, i) => i >= from && r[0] === unit)

describe('detecting the layout', () => {
  it('tells our format, Yardi, a generic table and an unknown file apart', () => {
    expect(detectLayout(parseCSV(fernhillDoc))).toBe('ours')
    expect(detectLayout(yardi())).toBe('yardi-lease-charges')
    expect(detectLayout(generic())).toBe('generic')
    expect(detectLayout([['Notes'], ['nothing tabular here']])).toBe('unknown')
  })

  it('never converts our own format or an unknown one', () => {
    expect(convertRentRoll(parseCSV(fernhillDoc)).blockers).toEqual([expect.stringMatching(/already an AVIANCRE rent roll/)])
    expect(convertRentRoll([['Notes']]).blockers).toEqual([expect.stringMatching(/No header row found in the first 30 rows.*\/convert-rent-roll/)])
  })
})

describe('Yardi Rent Roll with Lease Charges', () => {
  it('blocks on a resident marker nobody has classified', () => {
    const c = convertRentRoll(yardi())
    expect(c.blockers).toEqual([expect.stringMatching(/^Resident "MODEL" on 1 unit: choose what it means/)])
    expect(c.statusValues).toEqual([
      { value: 'VACANT', count: 1, choice: 'vacant', provenance: 'detected' },
      { value: 'MODEL', count: 1, choice: null, provenance: null },
    ])
  })

  const c = convertRentRoll(yardi(), { ...MODEL_VACANT, today: '2026-10-09' })

  it('reads the title, the two-row header and every column', () => {
    expect(c).toMatchObject({ format: 'yardi-lease-charges', name: 'Test Gardens', isSample: true, asOf: '2026-09-30', headerRow: 4, blockers: [] })
    expect(c.columns.slice(0, 8)).toEqual(['Unit', 'Unit Type', 'Unit Sq Ft', 'Resident', 'Name', 'Market Rent', 'Charge Code', 'Amount'])
    expect(c.fields.every((f) => f.column !== null && f.provenance === 'detected')).toBe(true)
  })

  it('takes rent from the rent charge and other charges as other income', () => {
    expect(c.units.map((u) => [u.unit, u.occupied, u.inPlace, u.otherIncome, u.preLeased])).toEqual([
      ['101', true, 1100, 25, false],
      ['102', false, 0, 0, true],
      ['103', true, 1450, 40, false],
      ['104', false, 0, 0, false],
    ])
    expect(c.chargeCodes.map((x) => [x.code, x.total, x.use])).toEqual([
      ['rent', 2550, 'rent'],
      ['petrent', 25, 'other'],
      ['storage', 40, 'other'],
    ])
    expect(c.flags).toContainEqual('Charge codes counted as other income: petrent, storage. Change any under Charge codes.')
  })

  it('ends a notice unit\'s lease at its move-out date, and flags it', () => {
    const u = c.units.find((x) => x.unit === '103')!
    expect(u).toMatchObject({ leaseEnd: '2026-11-30', balance: 250, inferred: ['leaseEnd'] })
    expect(u.notes).toEqual(['Unit type tg2a', 'Notice to vacate: lease end is the move-out date 2026-11-30'])
    expect(c.flags).toContainEqual('1 notice-to-vacate unit: lease end set to the move-out date.')
  })

  it('keeps a future resident\'s rent charges as the future lease rent', () => {
    const withRent = convertRentRoll(
      yardi((rows) => {
        const at = rowOf(rows, 102, rows.findIndex((r) => r[0] === 'Future Residents/Applicants'))
        rows[at][6] = 'rent'
        rows[at][7] = 1250
        rows.splice(at + 1, 1, charge('petrent', 25), blockTotal(1275), [], [103, 'tg2a', 850, 't004', 'Applicant', 1500, 'rnt', 1525], blockTotal(1525))
      }),
      MODEL_VACANT,
    )
    expect(withRent.units.map((u) => [u.unit, u.preLeased, u.futureRent])).toEqual([
      ['101', false, undefined],
      ['102', true, 1250],
      ['103', true, 1525],
      ['104', false, undefined],
    ])
    expect(withRent.flags).toContainEqual('2 future residents with a rent charge: kept as the future lease rent.')
    expect(c.units.find((u) => u.unit === '102')?.futureRent).toBeUndefined()
    const header = conversionGrid(withRent)[12]
    expect(conversionGrid(withRent)[14][header.indexOf('Future lease rent ($/mo)')]).toBe(1250)
  })

  it('groups floor plans by SF + market rent, named by SF, with the unit type codes as notes', () => {
    expect(c.plans.map((p) => [p.key, p.name, p.units, p.codes])).toEqual([
      ['600|1200', '600 SF', 2, ['tg1a', 'tg1b']],
      ['850|1500', '850 SF', 2, ['tg2a']],
    ])
  })

  it('matches every total the file states, counting non-revenue units as vacant', () => {
    expect(totalsMismatches(c)).toEqual([])
    expect(c.totals.map((t) => [t.label, t.converted, t.file])).toEqual([
      ['Units', 4, 4],
      ['Occupied', 2, 2],
      ['Vacant', 2, 2],
      ['Pre-leased', 1, null],
      ['Rentable SF', 2900, 2900],
      ['Market rent, all units ($/mo)', 5400, 5400],
      ['Market rent, occupied ($/mo)', 2700, 2700],
      ['Market rent, vacant ($/mo)', 2700, 2700],
      ['In-place rent, occupied ($/mo)', 2550, 2550],
      ['Rent + vacant market ($/mo)', 5250, 5250],
      ['Other income ($/mo)', 65, 65],
    ])
    expect(c.flags).toContainEqual(expect.stringMatching(/1 non-revenue unit .* counts them as vacant/))
  })

  it('validates as our unit rent roll', () => {
    const r = validate(c)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.summary).toEqual({ kind: 'multifamily', name: 'Test Gardens', rentableSF: 2900, units: 4, occupiedUnits: 2, floorPlans: 2 })
    expect(r.property).toMatchObject({ id: 'deal-test-gardens', isSample: true })
    expect(conversionCSV(c).split('\n')[0]).toBe('Test Gardens: unit rent roll (fictional sample data)')
  })

  it('shows a mismatch when the file\'s totals disagree', () => {
    const tampered = convertRentRoll(
      yardi((rows) => (rows[rows.findIndex((r) => r[0] === 'rent')][3] = 2500)),
      MODEL_VACANT,
    )
    expect(totalsMismatches(tampered).map((t) => [t.label, t.converted, t.file])).toEqual([
      ['In-place rent, occupied ($/mo)', 2550, 2500],
      ['Rent + vacant market ($/mo)', 5250, 5200],
    ])
  })

  it('reclassifies a charge code on request, and checks against the file with the same classification', () => {
    const r = convertRentRoll(yardi(), { ...MODEL_VACANT, chargeCodes: { storage: 'rent' } })
    expect(r.units.find((u) => u.unit === '103')).toMatchObject({ inPlace: 1490, otherIncome: 0 })
    expect(r.chargeCodes.find((x) => x.code === 'storage')).toMatchObject({ use: 'rent', provenance: 'user' })
    expect(totalsMismatches(r)).toEqual([])
  })

  it('flags charges that don\'t add up to the unit\'s Total row', () => {
    const r = convertRentRoll(yardi((rows) => (rows[rowOf(rows, 101) + 2][7] = 1130)), MODEL_VACANT)
    expect(r.flags).toContainEqual("Charges don't add up to the unit's Total row for units 101.")
  })

  it('blocks on an occupied unit with no rent charge, or a future resident for an unknown unit', () => {
    const noRent = convertRentRoll(yardi(), { ...MODEL_VACANT, chargeCodes: { rent: 'other' } })
    expect(noRent.blockers).toContainEqual('No charge code counts as rent. Set the rent code under Charge codes.')
    const future = convertRentRoll(
      yardi((rows) => (rows[rowOf(rows, 102, rows.findIndex((r) => r[0] === 'Future Residents/Applicants'))][0] = 999)),
      MODEL_VACANT,
    )
    expect(future.blockers).toEqual([expect.stringMatching(/^Future residents for units not in the current section: 999 \(row \d+\)/)])
  })

  it('treats a mapped marker as occupied or vacant, with a note', () => {
    const asOccupied = convertRentRoll(yardi(), { statusValues: { MODEL: 'occupied' } })
    expect(asOccupied.blockers).toEqual([expect.stringMatching(/Occupied with no rent charge: units 104/)])
    expect(c.units.find((u) => u.unit === '104')).toMatchObject({ inferred: ['status'], notes: ['Unit type tg2a', 'Resident "MODEL" treated as vacant'] })
  })

  it('lets the user remap or drop a column', () => {
    const r = convertRentRoll(yardi(), { ...MODEL_VACANT, mapping: { balance: null } })
    expect(field(r, 'balance')).toEqual({ column: null, provenance: 'user' })
    expect(r.units.find((u) => u.unit === '103')?.balance).toBe(0)
    const missing = convertRentRoll(yardi(), { ...MODEL_VACANT, mapping: { market: null } })
    expect(missing.blockers).toEqual(['Map a column to "Market rent" to continue.'])
    expect(missing.units).toEqual([])
  })

  it('flags an old as-of date', () => {
    const old = convertRentRoll(yardi((rows) => (rows[2][0] = 'As Of = 10/16/2019')), { ...MODEL_VACANT, today: '2026-10-09' })
    expect(old.flags).toContainEqual(expect.stringMatching(/^The rent roll is as of 2019-10-16, about 7 years ago/))
  })
})

describe('presets', () => {
  const first = convertRentRoll(yardi(), { ...MODEL_VACANT, chargeCodes: { storage: 'excluded' } })
  const preset = presetFrom(first, 'Test PM export', '2026-10-09')

  it('save the mapping, charge codes and status values', () => {
    expect(preset).toMatchObject({
      name: 'Test PM export',
      format: 'yardi-lease-charges',
      mapping: { unit: 'Unit', sf: 'Unit Sq Ft', market: 'Market Rent', leaseEnd: 'Lease Expiration' },
      chargeCodes: { rent: 'rent', petrent: 'other', storage: 'excluded' },
      statusValues: { VACANT: 'vacant', MODEL: 'vacant' },
    })
  })

  it('convert the same layout without asking again', () => {
    const again = convertRentRoll(yardi(), { presets: [preset] })
    expect(again.presetName).toBe('Test PM export')
    expect(again.blockers).toEqual([])
    expect(again.statusValues.find((s) => s.value === 'MODEL')).toMatchObject({ choice: 'vacant', provenance: 'preset' })
    expect(again.chargeCodes.find((s) => s.code === 'storage')).toMatchObject({ use: 'excluded', provenance: 'preset' })
    expect(field(again, 'unit').provenance).toBe('preset')
    expect(again.units).toEqual(first.units)
  })

  it('don\'t apply to a different header', () => {
    const other = convertRentRoll(yardi((rows) => (rows[3][13] = 'Bal')), { presets: [preset] })
    expect(other.presetName).toBeUndefined()
    expect(other.blockers).toEqual([expect.stringMatching(/^Resident "MODEL"/)])
  })

  describe('floor plan names', () => {
    const renamed = convertRentRoll(yardi(), { ...MODEL_VACANT, planNames: { '600|1200': '1 Bed' } })
    const named = presetFrom(renamed, 'Named plans')

    it('are saved when renamed, and only those', () => {
      expect(named.planNames).toEqual({ '600|1200': '1 Bed' })
      expect(preset).not.toHaveProperty('planNames')
    })

    it('come back when the same layout is converted again', () => {
      const again = convertRentRoll(yardi(), { presets: [named] })
      expect(again.plans.map((p) => [p.name, p.nameFromPreset ?? false])).toEqual([
        ['1 Bed', true],
        ['850 SF', false],
      ])
      expect(again.units.filter((u) => u.plan === '1 Bed').map((u) => u.unit)).toEqual(['101', '102'])
      expect(again.flags).toContainEqual(expect.stringMatching(/; 1 named by the preset\./))
      expect(presetFrom(again, 'Named plans').planNames).toEqual({ '600|1200': '1 Bed' })
    })

    it('follow a plan whose market rent changed, when it is the only plan at that SF', () => {
      const raised = yardi((rows) => {
        rows[rowOf(rows, 101)][5] = 1250
        rows[rowOf(rows, 102)][5] = 1250
      })
      expect(convertRentRoll(raised, { presets: [named] }).plans.map((p) => [p.key, p.name])).toEqual([
        ['600|1250', '1 Bed'],
        ['850|1500', '850 SF'],
      ])
      // Two plans at 600 SF now: the unchanged one keeps its name; the new one can't be told apart, so it keeps the default.
      const split = yardi((rows) => (rows[rowOf(rows, 101)][5] = 1250))
      expect(convertRentRoll(split, { presets: [named] }).plans.map((p) => p.name)).toEqual(['600 SF · $1,250', '1 Bed', '850 SF'])
    })

    it('give way to a name typed on the mapping screen', () => {
      const typed = convertRentRoll(yardi(), { presets: [named], planNames: { '600|1200': 'One bedroom' } })
      expect(typed.plans[0]).toMatchObject({ name: 'One bedroom' })
      expect(typed.plans[0].nameFromPreset).toBeUndefined()
    })

    it('round-trip through the presets file', () => {
      expect(presetsFromFile(JSON.parse(JSON.stringify(presetsFile([named]))))).toEqual([named])
      expect(presetsFromFile(presetsFile([{ ...named, planNames: 'oops' as never }]))).toEqual([])
    })
  })

  it('replace an older preset for the same layout, and round-trip through the presets file', () => {
    const list = withPreset([preset], { ...preset, name: 'Renamed' })
    expect(list.map((p) => p.name)).toEqual(['Renamed'])
    expect(presetsFromFile(JSON.parse(JSON.stringify(presetsFile(list))))).toEqual(list)
    expect(presetsFromFile({ format: 'something-else', presets: [] })).toBeNull()
  })
})

// ---- a generic table: title rows, header on row 6 with synonyms, a subtotal and a totals row ----
function generic(edit: (rows: Cell[][]) => void = () => {}): Cell[][] {
  const rows: Cell[][] = [
    ['Maple Court'],
    ['Rent Roll'],
    ['As of 9/30/2026'],
    [],
    ['Run by: property management software'],
    ['Apt #', 'Bed/Bath', 'Sq. Ft.', 'Tenant', 'Mkt Rent', 'Rent', 'Lease Exp', 'Balance'],
    ['1A', '1x1', 600, 'Resident A', 1200, 1150, '3/31/2027', 0],
    ['1B', '1x1', 600, 'VACANT', 1200, '', '', 0],
    ['', '', 1200, '', 2400, 1150, '', ''],
    ['2A', '2x2', 1200, 'Resident B', 2400, 1100, '2027-06-30', 125],
    [],
    ['Totals', '', 2400, '', 4800, 2250, '', 125],
  ]
  edit(rows)
  return rows
}

describe('generic tables', () => {
  const c = convertRentRoll(generic())

  it('finds the header below the title rows and maps columns by synonym', () => {
    expect(c).toMatchObject({ format: 'generic', headerRow: 6, name: 'Maple Court', asOf: '2026-09-30', blockers: [] })
    expect(Object.fromEntries(c.fields.filter((f) => f.column !== null).map((f) => [f.key, c.columns[f.column!]]))).toEqual({
      unit: 'Apt #',
      unitType: 'Bed/Bath',
      sf: 'Sq. Ft.',
      resident: 'Tenant',
      market: 'Mkt Rent',
      inPlace: 'Rent',
      leaseEnd: 'Lease Exp',
      balance: 'Balance',
    })
    expect(field(c, 'sf').provenance).toBe('synonym')
  })

  it('infers status from the tenant column, flagged, and skips the subtotal row', () => {
    expect(c.units.map((u) => [u.unit, u.occupied, u.inPlace, u.leaseEnd ?? null])).toEqual([
      ['1A', true, 1150, '2027-03-31'],
      ['1B', false, 0, null],
      ['2A', true, 1100, '2027-06-30'],
    ])
    expect(c.units.every((u) => u.inferred.includes('status'))).toBe(true)
    expect(c.flags).toContainEqual(expect.stringMatching(/^No status column: 3 units' status inferred from the tenant column/))
    expect(c.flags).toContainEqual(expect.stringMatching(/^1 row with numbers but no unit .* skipped/))
  })

  it('names a plan after the file\'s unit type when the plan has exactly one', () => {
    expect(c.plans.map((p) => [p.name, p.units])).toEqual([
      ['1x1', 2],
      ['2x2', 1],
    ])
  })

  it('checks against the totals row and validates', () => {
    expect(totalsMismatches(c)).toEqual([])
    expect([total(c, 'Rentable SF').file, total(c, 'Market rent, all').file, total(c, 'In-place rent').file]).toEqual([2400, 4800, 2250])
    expect(total(c, 'Units').match).toBeNull()
    expect(errorsOf(c)).toEqual([])
  })

  it('blocks on an unmapped required column until the user maps it', () => {
    const rows = generic((r) => (r[5][2] = 'Footprint'))
    expect(convertRentRoll(rows).blockers).toEqual(['Map a column to "SF" to continue.'])
    const fixed = convertRentRoll(rows, { mapping: { sf: 2 } })
    expect(fixed.blockers).toEqual([])
    expect(field(fixed, 'sf')).toEqual({ column: 'Footprint', provenance: 'user' })
  })

  it('blocks on a status value nobody has classified', () => {
    const rows = generic((r) => {
      r[5].push('Status')
      r[6].push('Occupied')
      r[7].push('Model')
      r[9].push('Notice Rented')
    })
    const blocked = convertRentRoll(rows)
    expect(blocked.blockers).toEqual([expect.stringMatching(/^Status "Model" on 1 unit/)])
    const r = convertRentRoll(rows, { statusValues: { Model: 'vacant' } })
    expect(r.blockers).toEqual([])
    expect(r.units.map((u) => [u.unit, u.occupied, u.preLeased])).toEqual([
      ['1A', true, false],
      ['1B', false, false],
      ['2A', true, true],
    ])
  })

  it('needs a property name', () => {
    const rows = generic((r) => r.splice(0, 5))
    expect(convertRentRoll(rows).blockers).toEqual(['No property name in the file. Enter one under Property name.'])
    expect(convertRentRoll(rows, { name: 'Maple Court' }).blockers).toEqual([])
  })

  it('renames floor plans, and merges plans given the same name', () => {
    const r = convertRentRoll(generic(), { planNames: { '600|1200': 'Flat', '1200|2400': 'Flat' } })
    expect(r.units.map((u) => u.plan)).toEqual(['Flat', 'Flat', 'Flat'])
    expect(validate(r).summary).toMatchObject({ floorPlans: 1 })
  })
})
