import type { Property } from '../../types'
import { fmt } from '../../lib/format'
import { activeLeases, expiringWithin, monthsUntil, occupancy } from '../../lib/metrics'
import { stackingPlan } from '../../lib/stacking'
import { useAppStore } from '../../store/useAppStore'
import { Card, Note, Stat } from '../ui/Card'
import { EXPIRY_FLAG_MONTHS, LeaseRegistryTable, UnitMixTable } from '../tables/LeaseTables'

/** Stacking-plan color by how soon the lease rolls, relative to the analysis year. */
function expiryColor(expirationYear: number | undefined, asOfYear: number): string {
  if (expirationYear === undefined) return '#475569' // vacant
  const yearsOut = expirationYear - asOfYear
  if (yearsOut <= 1) return '#ef4444'
  if (yearsOut <= 3) return '#f59e0b'
  return '#22c55e'
}

export default function BrokerView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)

  if (p.rentRoll.kind === 'multifamily') {
    return (
      <div className="space-y-4">
        <Card title="Unit mix & occupancy">
          <div className="mb-3">
            <Stat label="Occupancy" value={fmt.pct(occupancy(p, asOf))} />
          </div>
          <UnitMixTable rentRoll={p.rentRoll} />
          <Note>Apartment leases are short-term (typically 12 months), so rollover is tracked at the unit-type level.</Note>
        </Card>
      </div>
    )
  }

  const asOfYear = Number(asOf.slice(0, 4))
  const leasedSF = activeLeases(p, asOf).reduce((s, l) => s + l.leasedSF, 0)
  const windows = [12, 24, 36].map((m) => {
    const sf = expiringWithin(p, asOf, m).reduce((s, l) => s + l.leasedSF, 0)
    return { months: m, sf, share: leasedSF ? sf / leasedSF : 0 }
  })
  const flagged = expiringWithin(p, asOf, EXPIRY_FLAG_MONTHS)
  const plan = stackingPlan(p, asOf)

  return (
    <div className="space-y-4">
      <Card title="Lease expiration exposure">
        <div className="grid grid-cols-3 gap-2">
          {windows.map((w) => (
            <Stat key={w.months} label={`Next ${w.months} mo`} value={fmt.pct(w.share, 0)} hint={fmt.sf(w.sf)} tone={w.share > 0.2 ? 'warn' : undefined} />
          ))}
        </div>
        {flagged.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {flagged.map((l) => (
              <li key={l.id} className="flex items-center justify-between rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                <span>
                  ⚑ <span className="font-medium">{l.tenantName}</span>
                  <span className="text-amber-200/70"> · {fmt.sf(l.leasedSF)}</span>
                </span>
                <span className="tabular-nums">{Math.max(0, Math.round(monthsUntil(asOf, l.expirationDate)))} mo</span>
              </li>
            ))}
          </ul>
        ) : (
          <Note>No leases expire in the next {EXPIRY_FLAG_MONTHS} months.</Note>
        )}
      </Card>

      {plan && (
        <Card title="Stacking plan">
          <div className="space-y-0.5">
            {plan.map((f) => (
              <div key={f.floor} className="flex items-center gap-2">
                <span className="w-6 text-right text-[10px] tabular-nums text-slate-500">{f.floor}</span>
                <div className="flex h-4 flex-1 overflow-hidden rounded-sm bg-slate-700/40">
                  {f.segments.length === 0 ? (
                    <span className="px-1 text-[9px] leading-4 text-slate-500">Lobby / common area</span>
                  ) : (
                    f.segments.map((s) => (
                      <div
                        key={s.key}
                        title={`${s.label} · ${fmt.sf(Math.round(s.sf))}${s.expirationYear ? ` · exp ${s.expirationYear}` : ''}`}
                        className={`h-full border-r border-slate-900 ${s.kind === 'vacant' ? 'bg-[repeating-linear-gradient(45deg,#475569_0_3px,#334155_3px_6px)]' : ''}`}
                        style={{
                          width: `${(s.sf / f.totalSF) * 100}%`,
                          backgroundColor: s.kind === 'lease' ? expiryColor(s.expirationYear, asOfYear) : undefined,
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
            <Legend color="#ef4444" label={`Exp ≤ ${asOfYear + 1}`} />
            <Legend color="#f59e0b" label={`${asOfYear + 2}–${asOfYear + 3}`} />
            <Legend color="#22c55e" label={`${asOfYear + 4}+`} />
            <Legend color="#475569" label="Vacant" />
          </div>
          <Note>Hover a block for tenant, SF and expiration. Multi-floor leases are split evenly across their floors.</Note>
        </Card>
      )}

      <Card title="Tenant lease registry">
        <LeaseRegistryTable rentRoll={p.rentRoll} asOf={asOf} />
      </Card>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
