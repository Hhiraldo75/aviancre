import type { RentRollRow, RentRollView, UnitMixRow } from '../../lib/underwriting/fullView'
import SourceBadge from '../ui/SourceBadge'
import ExpirationChart from './ExpirationChart'

const COLUMNS: [label: string, key: keyof RentRollRow, align: 'left' | 'right'][] = [
  ['Suite', 'suite', 'left'],
  ['Tenant', 'tenant', 'left'],
  ['SF', 'sf', 'right'],
  ['% bldg', 'pctOfBuilding', 'right'],
  ['Start', 'start', 'right'],
  ['End', 'end', 'right'],
  ['Remaining', 'remaining', 'right'],
  ['Rent $/SF', 'rent', 'right'],
  ['Market at exp. $/SF', 'marketAtExpiration', 'right'],
  ['vs market', 'vsMarket', 'right'],
  ['Escalation', 'escalation', 'left'],
  ['Recovery', 'recovery', 'left'],
  ['Renewal option', 'renewalOption', 'left'],
]

const UNIT_MIX_COLUMNS: [label: string, key: keyof UnitMixRow][] = [
  ['Units', 'units'],
  ['Occupied', 'occupied'],
  ['Vacant', 'vacant'],
  ['Pre-leased', 'preLeased'],
  ['Avg SF', 'avgSF'],
  ['Market', 'market'],
  ['In-place', 'inPlace'],
  ['Loss to lease', 'lossToLease'],
  ['LTL %', 'lossToLeasePct'],
  ['LTL $/yr', 'lossToLeaseAnnual'],
]

const th = 'whitespace-nowrap px-3 py-2 font-medium'
const alignClass = { left: 'text-left', right: 'text-right' } as const
const td = 'whitespace-nowrap px-3 py-1.5'

/** Lease-by-lease rent roll and expiration schedule; apartments show their unit mix. */
export default function RentRollTab({ rentRoll: rr }: { rentRoll: RentRollView }) {
  if (rr.kind === 'unit-mix') return <UnitMix view={rr} />

  const t = rr.totals
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[10px] text-slate-400">
          Rents are annual $/SF on the analysis date; remaining term runs from the analysis start. Market at expiration is
          the market rent in the year the space re-leases (lease-up year for vacant suites). vs market is in-place ÷ Year-1
          market − 1. Rent roll
          <SourceBadge data={rr.source} />
        </p>
        <div className="overflow-x-auto rounded border border-slate-700">
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                {COLUMNS.map(([label, , align]) => (
                  <th key={label} className={`${th} ${alignClass[align]}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rr.rows.map((row) => (
                <tr key={row.id} className={`border-t border-slate-700/70 ${row.vacant ? 'italic text-slate-400' : 'text-slate-300'}`}>
                  {COLUMNS.map(([label, key, align]) => (
                    <td
                      key={label}
                      className={`${td} ${alignClass[align]} ${key === 'tenant' && !row.vacant ? 'font-medium text-slate-100' : ''} ${
                        key === 'vsMarket' && row.vsMarketTone === 'above' ? 'text-amber-300' : ''
                      } ${key === 'vsMarket' && row.vsMarketTone === 'below' ? 'text-emerald-400' : ''}`}
                    >
                      {String(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-slate-600 font-semibold text-slate-100">
                <td className={td}>Total</td>
                <td className={td}>{t.occupancy} occupied</td>
                <td className={`${td} text-right`}>{t.sf}</td>
                <td className={`${td} text-right`}>{t.pctOfBuilding}</td>
                <td className={td} />
                <td className={td} />
                <td className={`${td} text-right`}>WALT {t.walt}</td>
                <td className={`${td} text-right`}>{t.rent}</td>
                <td className={`${td} text-right`}>{t.market}</td>
                <td className={`${td} text-right`}>{t.vsMarket}</td>
                <td className={td} colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="max-w-xl">
        <ExpirationChart years={rr.expirationChart} />
      </div>

      <div className="max-w-xl">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lease expiration schedule</h3>
        <p className="mb-2 text-[10px] text-slate-500">
          SF expiring in each hold year. "All modeled" adds re-leased space that rolls again within the hold.
        </p>
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className={`${th} pl-0 text-left`}>Year</th>
              <th className={`${th} text-right`}>In-place SF</th>
              <th className={`${th} text-right`}>% bldg</th>
              <th className={`${th} text-right`}>All modeled SF</th>
              <th className={`${th} pr-0 text-right`}>% bldg</th>
            </tr>
          </thead>
          <tbody>
            {rr.expirations.map((e) => (
              <tr key={e.year} className="border-t border-slate-700/70 text-slate-300">
                <td className={`${td} pl-0`}>{e.year}</td>
                <td className={`${td} text-right`}>{e.inPlaceSF}</td>
                <td className={`${td} text-right`}>{e.inPlacePct}</td>
                <td className={`${td} text-right`}>{e.totalSF}</td>
                <td className={`${td} pr-0 text-right`}>{e.totalPct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UnitMix({ view }: { view: Extract<RentRollView, { kind: 'unit-mix' }> }) {
  const columns = view.byUnit ? UNIT_MIX_COLUMNS : UNIT_MIX_COLUMNS.filter(([, key]) => key !== 'preLeased')
  return (
    <div>
      <p className="mb-2 text-[10px] text-slate-400">
        Rents are per unit per month: market averages all units, in-place averages occupied units. Loss to lease is market − in-place
        on occupied units; it burns off as each lease rolls to market at its lease end
        {view.byUnit ? ', and vacant units lease up at market, pre-leased first' : ''}. Unit mix
        <SourceBadge data={view.source} />
      </p>
      <div className="overflow-x-auto rounded border border-slate-700">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className={`${th} text-left`}>Floor plan</th>
              {columns.map(([label]) => (
                <th key={label} className={`${th} text-right`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-700/70 text-slate-300">
                <td className={`${td} font-medium text-slate-100`}>{row.floorPlan}</td>
                {columns.map(([label, key]) => (
                  <td key={label} className={`${td} text-right`}>
                    {row[key]}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-slate-600 font-semibold text-slate-100">
              <td className={td}>{view.totals.floorPlan}</td>
              {columns.map(([label, key]) => (
                <td key={label} className={`${td} text-right`}>
                  {view.totals[key]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
