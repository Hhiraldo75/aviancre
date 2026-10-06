import { useState } from 'react'
import type { Property } from '../../types'
import { fmt } from '../../lib/format'
import { walt } from '../../lib/metrics'
import { QUICK_ASSUMPTIONS, quickFinancials, type PurchaseBasis } from '../../lib/quickFinancials'
import { useAppStore } from '../../store/useAppStore'
import { Card, Note, Stat, StatGrid } from '../ui/Card'

const BASES: { id: PurchaseBasis; label: string }[] = [
  { id: 'implied-value', label: 'Implied market value' },
  { id: 'assessed-value', label: 'Assessed value' },
]

export default function InvestmentView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const [basis, setBasis] = useState<PurchaseBasis>('implied-value')
  const q = quickFinancials(p, asOf, basis)
  const w = walt(p, asOf)
  const maxNOI = Math.max(...q.noiByYear)

  return (
    <div className="space-y-4">
      <Card title="Projection metrics" aside={<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">QUICK ESTIMATE</span>}>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-slate-900 p-1">
          {BASES.map((b) => (
            <button
              key={b.id}
              onClick={() => setBasis(b.id)}
              className={`rounded px-2 py-1 text-[11px] ${basis === b.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-100'}`}
            >
              Buy at {b.label.toLowerCase()}
            </button>
          ))}
        </div>
        <StatGrid>
          <Stat label="Year-1 NOI" value={fmt.usd(q.noi)} />
          <Stat
            label="Purchase price"
            value={fmt.usdCompact(q.purchasePrice)}
            hint={
              p.physical.unitCount
                ? `${fmt.usdCompact(q.purchasePrice / p.physical.unitCount.value)}/unit`
                : `${fmt.usd(q.purchasePrice / p.physical.rentableSF.value)}/SF`
            }
          />
          <Stat label="Unlevered IRR" value={q.unleveredIRR !== null ? fmt.pct(q.unleveredIRR) : '—'} hint={`${QUICK_ASSUMPTIONS.holdYears}-yr hold`} />
          <Stat label="Equity multiple" value={`${q.equityMultiple.toFixed(2)}x`} />
          <Stat label="Going-in cap" value={fmt.pct(q.goingInCapRate, 2)} />
          <Stat label="WALT" value={w !== null ? fmt.years(w) : 'n/a (multifamily)'} tone={w !== null && w < 3 ? 'warn' : undefined} hint={w !== null && w < 3 ? 'Near-term rollover risk' : undefined} />
        </StatGrid>
      </Card>

      <Card title="Year-1 NOI build">
        <dl className="space-y-1 text-xs">
          <Row label="Gross revenue (in-place)" value={fmt.usd(q.grossRevenue)} />
          <Row label="Landlord-paid opex" value={`(${fmt.usd(q.landlordOpex)})`} />
          <Row label={`Management (${fmt.pct(QUICK_ASSUMPTIONS.managementFeePct, 0)})`} value={`(${fmt.usd(q.managementFee)})`} />
          <div className="border-t border-slate-700 pt-1">
            <Row label="Net operating income" value={fmt.usd(q.noi)} strong />
          </div>
        </dl>
      </Card>

      <Card title="NOI projection">
        <div className="flex h-20 items-end gap-1">
          {q.noiByYear.map((n, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-blue-500/80" style={{ height: `${(n / maxNOI) * 64}px` }} title={`Year ${i + 1}: ${fmt.usd(n)}`} />
              <span className="text-[9px] text-slate-500">{i + 1}</span>
            </div>
          ))}
        </div>
        <StatGrid>
          <Stat label="NOI growth" value={`${fmt.pct(q.noiGrowth)}/yr`} hint="Submarket rent growth" />
          <Stat label="Exit value" value={fmt.usdCompact(q.exitValue)} hint={`${fmt.pct(q.exitCapRate, 2)} exit cap, net of ${fmt.pct(QUICK_ASSUMPTIONS.sellingCostsPct, 0)} costs`} />
        </StatGrid>
        <Note>
          Simplified: NOI grows at submarket rent growth, with no lease rollover, downtime, TI/LC, capex or debt. The full
          lease-by-lease underwriting engine will replace this.
        </Note>
      </Card>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
