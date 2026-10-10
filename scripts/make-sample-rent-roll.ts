/**
 * Writes the public multifamily sample, Fernhill Commons (invented numbers),
 * in two forms from one list of units:
 *
 *   docs/samples/fernhill-commons-raw.xlsx              a Yardi-style "Rent Roll with Lease Charges"
 *   docs/samples/fernhill-commons-unit-rent-roll.csv    the same units in our unit rent roll format
 *
 * The raw file is the converter's test input; the CSV is what converting it
 * must give. Deterministic (seeded), so re-running only changes the files when
 * this script changes.
 *
 *   npx vite-node scripts/make-sample-rent-roll.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const AS_OF = '2026-09-30'
const NAME = 'Fernhill Commons Apartments'
const OUT = 'docs/samples'

// Seeded PRNG (mulberry32).
let seed = 20260930
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
const chance = (p: number) => rand() < p

const PLANS = {
  A: { sf: 560, market: 1295, codes: ['fh560a', 'fh560b'] },
  B: { sf: 735, market: 1525, codes: ['fh735a', 'fh735b', 'fh735c'] },
  C: { sf: 960, market: 1850, codes: ['fh960a', 'fh960b'] },
  D: { sf: 1180, market: 2240, codes: ['fh1180a', 'fh1180b'] },
}
type PlanKey = keyof typeof PLANS

/** Positions 1–30 on each floor: 12 B, then A and C (8/7 on floors 1–2, 7/8 on 3–4), then 3 D. */
function planAt(floor: number, pos: number): PlanKey {
  const aCount = floor <= 2 ? 8 : 7
  if (pos <= 12) return 'B'
  if (pos <= 12 + aCount) return 'A'
  if (pos <= 27) return 'C'
  return 'D'
}

const VACANT = new Set(['104', '117', '209', '222', '230', '305', '318', '321', '412', '427'])
const NOTICE: Record<string, string> = { '214': '2026-10-31' }
/** Units with a future resident: three vacant, and the notice unit. */
const PRE_LEASED = new Set(['117', '305', '427', '214'])
const BELOW_MARKET = new Set(['102', '115', '203', '311', '320', '408'])
/** Fixed lease ends: one expired (month-to-month), and the notice unit's lease, which runs past its move-out. */
const LEASE_END: Record<string, string> = { '126': '2026-07-31', '214': '2027-03-31' }
const NO_EXPIRATION = new Set(['323'])
const BALANCES: Record<string, number> = { '108': 412.5, '221': 1260, '316': -85.25, '402': 75, '129': -310 }

const OTHER_CHARGES: [code: string, amounts: number[], p: number][] = [
  ['petrent', [25, 35], 0.25],
  ['storage', [40, 50], 0.15],
  ['w/d', [45], 0.2],
  ['park', [50], 0.15],
  ['insur', [12], 0.2],
]

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + months, 1))
  return t.toISOString().slice(0, 10)
}
const endOfMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
const dayBefore = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10)
const serial = (iso: string) => Date.parse(iso) / 86_400_000 + 25569
const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d}/${y}`
}

interface Unit {
  unit: string
  plan: PlanKey
  code: string
  resident: string
  occupied: boolean
  rent: number
  charges: [string, number][]
  deposit: number
  moveIn?: string
  leaseExpiration?: string
  moveOut?: string
  balance: number
}

const units: Unit[] = []
let residentNo = 0
const nextResident = () => `r${String(++residentNo).padStart(5, '0')}`
for (let floor = 1; floor <= 4; floor++) {
  for (let pos = 1; pos <= 30; pos++) {
    const unit = String(floor * 100 + pos)
    const plan = planAt(floor, pos)
    const { market, codes } = PLANS[plan]
    const code = pick(codes)
    if (VACANT.has(unit)) {
      units.push({ unit, plan, code, resident: 'VACANT', occupied: false, rent: 0, charges: [], deposit: 0, balance: 0 })
      continue
    }
    const ratio = BELOW_MARKET.has(unit) ? 0.78 + rand() * 0.04 : 0.9 + rand() * 0.14
    const rent = Math.round((market * ratio) / 5) * 5
    const charges: [string, number][] = [['rent', rent]]
    for (const [c, amounts, p] of OTHER_CHARGES) if (chance(p)) charges.push([c, pick(amounts)])
    // Yardi lists charges in no fixed order; rent is not always first.
    if (charges.length > 1 && chance(0.5)) charges.push(charges.shift()!)
    const leaseExpiration = LEASE_END[unit] ?? endOfMonth(addMonths(AS_OF, 1 + Math.floor(rand() * 12)))
    const tenure = chance(0.3) ? 12 * (1 + Math.floor(rand() * 4)) : 0
    const moveIn = addMonths(leaseExpiration, -11 - tenure)
    units.push({
      unit,
      plan,
      code,
      resident: nextResident(),
      occupied: true,
      rent,
      charges,
      deposit: pick([0, 150, 150, 400]),
      moveIn,
      leaseExpiration: NO_EXPIRATION.has(unit) ? undefined : leaseExpiration,
      moveOut: NOTICE[unit],
      balance: BALANCES[unit] ?? 0,
    })
  }
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const occupied = units.filter((u) => u.occupied)
const vacant = units.filter((u) => !u.occupied)
const chargeTotal = (u: Unit) => sum(u.charges.map(([, a]) => a))

// ---- raw Yardi-style workbook ----
type Row = (string | number)[]
const rows: Row[] = []
const dateCells: [r: number, c: number][] = []
const blank = (): Row => Array(14).fill('')
const push = (row: Row, dates: number[] = []) => {
  for (const c of dates) if (typeof row[c] === 'number') dateCells.push([rows.length, c])
  rows.push(row)
}
const titleRow = (s: string) => {
  const r = blank()
  r[0] = s
  push(r)
}
titleRow('Rent Roll with Lease Charges')
titleRow(`${NAME} (fictional sample data)`)
titleRow(`As Of = ${usDate(AS_OF)}`)
push(['Unit', 'Unit Type', 'Unit', 'Resident', 'Name', 'Market', 'Charge', 'Amount', 'Resident', 'Other', 'Move In', 'Lease', 'Move Out', 'Balance'])
push(['', '', ' Sq Ft', '', '', ' Rent', ' Code', '', ' Deposit', ' Deposit', '', ' Expiration', '', ''])
titleRow('Current/Notice/Vacant Residents')
const totalRow = (amount: number) => {
  const r = blank()
  r[6] = 'Total'
  r[7] = amount
  push(r)
  push(blank())
}
for (const u of units) {
  const { sf, market } = PLANS[u.plan]
  const [first, ...rest] = u.charges
  push(
    [
      Number(u.unit),
      u.code,
      sf,
      u.resident,
      u.occupied ? 'Resident' : 'VACANT',
      market,
      first?.[0] ?? '',
      first?.[1] ?? 0,
      u.deposit,
      0,
      u.moveIn ? serial(u.moveIn) : '',
      u.leaseExpiration ? serial(u.leaseExpiration) : '',
      u.moveOut ? serial(u.moveOut) : '',
      u.balance,
    ],
    [10, 11, 12],
  )
  for (const [c, a] of rest) {
    const r = blank()
    r[6] = c
    r[7] = a
    push(r)
  }
  totalRow(chargeTotal(u))
}
titleRow('Future Residents/Applicants')
let futureBalance = 0
for (const u of units.filter((x) => PRE_LEASED.has(x.unit))) {
  const { sf, market } = PLANS[u.plan]
  const moveIn = u.moveOut ? addMonths(u.moveOut, 1).slice(0, 8) + '15' : addMonths(AS_OF, 1)
  const balance = -pick([150, 200, 250])
  futureBalance += balance
  push([Number(u.unit), u.code, sf, nextResident(), 'Applicant', market, '', 0, 0, 0, serial(moveIn), serial(dayBefore(addMonths(moveIn, 12))), '', balance], [10, 11])
  totalRow(0)
}
const marketTotal = sum(units.map((u) => PLANS[u.plan].market))
const actualTotal = sum(occupied.map(chargeTotal))
const depositTotal = sum(units.map((u) => u.deposit))
const currentBalance = sum(units.map((u) => u.balance))
push(['', '', '', 'Total', `${NAME} (fh)`, marketTotal, '', actualTotal, depositTotal, 0, '', '', '', currentBalance + futureBalance])
push(blank())
push(blank())
const sfOf = (us: Unit[]) => sum(us.map((u) => PLANS[u.plan].sf))
const mktOf = (us: Unit[]) => sum(us.map((u) => PLANS[u.plan].market))
const pct = (n: number, d: number) => Math.round((n / d) * 10000) / 100
const totalSF = sfOf(units)
push(['Summary Groups', '', '', '', '', 'Square', 'Market', 'Actual', 'Security', 'Other', '# Of', '% Unit', '% Sqft', 'Balance'])
push(['', '', '', '', '', 'Footage', 'Rent', 'Rent', 'Deposit', 'Deposits', 'Units', 'Occupancy', 'Occupied', ''])
push(['Current/Notice/Vacant Residents', '', '', '', '', '', '', actualTotal, depositTotal, 0, '', '', '', currentBalance])
push(['Future Residents/Applicants', '', '', '', '', '', '', 0, 0, 0, '', '', '', futureBalance])
push(['Occupied Units', '', '', '', '', sfOf(occupied), mktOf(occupied), '', '', '', occupied.length, pct(occupied.length, units.length), pct(sfOf(occupied), totalSF), ''])
push(['Total Non Rev Units', '', '', '', '', 0, 0, '', '', '', 0, 0, 0, ''])
push(['Total Vacant Units', '', '', '', '', sfOf(vacant), mktOf(vacant), '', '', '', vacant.length, pct(vacant.length, units.length), pct(sfOf(vacant), totalSF), ''])
push(['Totals:', '', '', '', '', totalSF, marketTotal, actualTotal, depositTotal, 0, units.length, 100, 100, currentBalance + futureBalance])
push(blank())
push(blank())
titleRow('Summary of Charges by Charge Code')
titleRow('(Current/Notice Residents Only)')
const codeRow = (code: string, amount: number | string) => {
  const r = blank()
  r[0] = code
  r[3] = amount
  push(r)
}
codeRow('Charge Code', 'Amount')
for (const code of ['rent', ...OTHER_CHARGES.map(([c]) => c)]) {
  codeRow(code, sum(occupied.flatMap((u) => u.charges.filter(([c]) => c === code).map(([, a]) => a))))
}
codeRow('Total', actualTotal)

// Blank cells are left empty, as a report export leaves them.
const sheet = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === '' ? null : c))))
for (const [r, c] of dateCells) {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })]
  cell.t = 'n'
  cell.z = 'm/d/yyyy'
}
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
const fixed = new Date(Date.UTC(2026, 8, 30))
wb.Props = { Title: 'Rent Roll with Lease Charges', CreatedDate: fixed, ModifiedDate: fixed }

// ---- the same units in our format ----
const csv: Row[] = [
  [`${NAME}: unit rent roll (fictional sample data)`],
  [`As of ${AS_OF}; rents are monthly $; converted from ${OUT}/fernhill-commons-raw.xlsx`],
  [],
  ['Property'],
  ['Asset type', 'multifamily'],
  ['Units', units.length],
  ['Rentable SF', totalSF],
  // Not in the raw file (a Yardi export has no property block): importing the .xlsx still asks for them.
  ['Class', 'B'],
  ['Submarket', 'olneyville'],
  ['Address', ''],
  [],
  ['Units'],
  [
    'Unit',
    'Floor plan',
    'SF',
    'Status',
    'Market rent ($/mo)',
    'In-place rent ($/mo)',
    'Other income ($/mo)',
    'Move-in',
    'Lease end',
    'Balance owed ($)',
    'Pre-leased (applicant)',
    'Future lease rent ($/mo)',
    'Note',
  ],
]
for (const u of units) {
  const { sf, market } = PLANS[u.plan]
  const notes = [`Unit type ${u.code}`, ...(u.moveOut ? [`Notice to vacate: lease end is the move-out date ${u.moveOut}`] : [])]
  csv.push([
    u.unit,
    `${sf} SF`,
    sf,
    u.occupied ? 'Occupied' : 'Vacant',
    market,
    u.rent,
    chargeTotal(u) - u.rent,
    u.moveIn ?? '',
    u.moveOut ?? u.leaseExpiration ?? '',
    u.balance,
    PRE_LEASED.has(u.unit) ? 'Yes' : '',
    '',
    notes.join('; '),
  ])
}

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/fernhill-commons-raw.xlsx`, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(`${OUT}/fernhill-commons-unit-rent-roll.csv`, csv.map((r) => r.join(',')).join('\n') + '\n')
console.log(
  `Wrote ${OUT}/fernhill-commons-raw.xlsx and ${OUT}/fernhill-commons-unit-rent-roll.csv: ` +
    `${units.length} units, ${occupied.length} occupied, ${vacant.length} vacant, ${PRE_LEASED.size} pre-leased, ` +
    `rent $${sum(occupied.map((u) => u.rent))}, vacant market $${mktOf(vacant)}, other income $${actualTotal - sum(occupied.map((u) => u.rent))}`,
)
