import type { CommercialRentRoll, ISODate, MultifamilyRentRoll } from '../../types'
import { fmt } from '../../lib/format'
import { currentRentPerSF, isLeaseActive, monthsUntil } from '../../lib/metrics'
import SourceBadge from '../ui/SourceBadge'

/** Leases expiring inside this window are flagged for re-leasing risk / prospecting. */
export const EXPIRY_FLAG_MONTHS = 18

export function LeaseRegistryTable({ rentRoll, asOf }: { rentRoll: CommercialRentRoll; asOf: ISODate }) {
  const leases = rentRoll.leases
    .filter((l) => isLeaseActive(l, asOf))
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))

  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
        <tr>
          <th className="pb-1 font-medium">Tenant / suite</th>
          <th className="pb-1 text-right font-medium">SF</th>
          <th className="pb-1 text-right font-medium">Rent/SF</th>
          <th className="pb-1 text-right font-medium">Expires</th>
        </tr>
      </thead>
      <tbody>
        {leases.map((l) => {
          const soon = monthsUntil(asOf, l.expirationDate) <= EXPIRY_FLAG_MONTHS
          return (
            <tr key={l.id} className="border-t border-slate-700/70">
              <td className="py-1.5 pr-2">
                <div className="font-medium">
                  {l.tenantName}
                  {l === leases[0] && <SourceBadge data={l} />}
                </div>
                <div className="text-[10px] text-slate-500">
                  {l.suite} · {l.leaseType}
                  {l.credit ? ` · ${fmt.label(l.credit)}` : ''}
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmt.int(l.leasedSF)}</td>
              <td className="py-1.5 text-right tabular-nums">${currentRentPerSF(l, asOf).toFixed(2)}</td>
              <td className={`py-1.5 text-right tabular-nums ${soon ? 'font-semibold text-amber-300' : ''}`}>
                {soon && <span aria-label="Expiring soon">⚑ </span>}
                {fmt.monthYear(l.expirationDate)}
              </td>
            </tr>
          )
        })}
        {rentRoll.vacancies.map((v) => (
          <tr key={v.id} className="border-t border-slate-700/70 text-slate-400">
            <td className="py-1.5 pr-2 italic">Vacant – {v.suite}</td>
            <td className="py-1.5 text-right tabular-nums">{fmt.int(v.sf)}</td>
            <td className="py-1.5 text-right">—</td>
            <td className="py-1.5 text-right text-[10px]">
              {v.expectedLeaseUpMonths ? `~${v.expectedLeaseUpMonths} mo lease-up` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function UnitMixTable({ rentRoll }: { rentRoll: MultifamilyRentRoll }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
        <tr>
          <th className="pb-1 font-medium">Type</th>
          <th className="pb-1 text-right font-medium">Occ.</th>
          <th className="pb-1 text-right font-medium">Avg SF</th>
          <th className="pb-1 text-right font-medium">In-place</th>
          <th className="pb-1 text-right font-medium">Market</th>
        </tr>
      </thead>
      <tbody>
        {rentRoll.unitTypes.map((u) => (
          <tr key={u.id} className="border-t border-slate-700/70">
            <td className="py-1.5 font-medium">{u.label}</td>
            <td className="py-1.5 text-right tabular-nums">
              {u.occupiedUnits}/{u.unitCount}
            </td>
            <td className="py-1.5 text-right tabular-nums">{fmt.int(u.avgSF)}</td>
            <td className="py-1.5 text-right tabular-nums">
              {u.inPlaceRentMonthly ? fmt.usd(u.inPlaceRentMonthly.value) : '—'}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {fmt.usd(u.marketRentMonthly.value)}
              <SourceBadge data={u.marketRentMonthly} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
