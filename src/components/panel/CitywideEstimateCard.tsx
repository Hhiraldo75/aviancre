import type { ReactNode } from 'react'
import { AVG_UNIT_SF, RATIO_BANDS, SCREENING_LABEL, SCREENING_TYPE_LABELS, SKIP_REASONS, type EstimateLine } from '../../lib/citywide/estimate'
import { BAND_COLORS, type ScreeningRow } from '../../lib/citywide/view'
import { fmt } from '../../lib/format'
import { QUICK_ASSUMPTIONS } from '../../lib/quickFinancials'
import { Card, Chip, Note, Stat, StatGrid } from '../ui/Card'
import SourceBadge from '../ui/SourceBadge'

const LEASE_LABELS = { NNN: 'NNN: vacant space only', 'modified-gross': 'modified gross', 'full-service-gross': 'full-service: all space' } as const

/** The citywide screening estimate for a looked-up parcel, with every input and the NOI build. */
export default function CitywideEstimateCard({ row }: { row: ScreeningRow }) {
  const r = row.result
  const aside = (
    <span className="text-[11px]">
      <Chip tone="amber" title={SCREENING_LABEL}>
        Screening only
      </Chip>
    </span>
  )

  if (r.status === 'skipped') {
    return (
      <Card title="Screening estimate" aside={aside}>
        <p className="text-sm font-semibold">No estimate</p>
        <p className="mt-1 text-xs text-slate-400">
          {SKIP_REASONS[r.reason]}.{r.type && ` Type: ${SCREENING_TYPE_LABELS[r.type]}.`}
        </p>
      </Card>
    )
  }

  const band = RATIO_BANDS.find((b) => b.id === row.band)
  return (
    <Card title="Screening estimate" aside={aside}>
      <StatGrid>
        <Stat
          label="Estimated value"
          value={fmt.money(r.value.value)}
          src={r.value}
          hint={r.value.range ? `${fmt.money(r.value.range.low)} – ${fmt.money(r.value.range.high)}` : undefined}
        />
        <Stat label="Assessed (2025)" value={r.assessed ? fmt.money(r.assessed) : '—'} hint="Tax roll, all commercial records on the lot" />
        <Stat label="Estimate ÷ assessed" value={r.ratio !== undefined ? fmt.multiple(r.ratio) : '—'} hint="Absolute" />
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Vs peers</div>
          <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            {row.band !== 'skipped' && (
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/70" style={{ backgroundColor: BAND_COLORS[row.band] }} />
            )}
            {row.peerRatio !== undefined ? fmt.multiple(row.peerRatio) : '—'}
          </div>
          <div className="text-[10px] text-slate-400">
            {band?.label ?? 'No assessment'}
            {row.peerMedian &&
              ` · ${SCREENING_TYPE_LABELS[r.type].toLowerCase()} median ${fmt.multiple(row.peerMedian.median)} over ${fmt.int(row.peerMedian.count)} parcels`}
          </div>
        </div>
        <Stat label="Year-1 NOI" value={fmt.money(r.noi.value)} src={r.noi} />
      </StatGrid>

      <div className="mt-3 space-y-1 text-[11px] text-slate-300">
        <p>
          <span className="font-semibold">{SCREENING_TYPE_LABELS[r.type]}</span> · {r.market.method}
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-slate-400">
          {r.typeNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      {r.components.map((c) => (
        <div key={c.label} className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {c.label}
            {c.options.length > 1 && <span className="font-normal normal-case tracking-normal"> · average of office and retail</span>}
          </div>
          <div className={`mt-1 grid gap-2 ${c.options.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {c.options.map((l) => (
              <LineTable key={l.benchmarkType} line={l} heading={c.options.length > 1 ? `As ${l.benchmarkType}` : undefined} />
            ))}
          </div>
        </div>
      ))}

      <Note>
        {SCREENING_LABEL}: class B benchmark rent, vacancy, expenses and cap rate applied to public building data, with rentable
        area an assumed share of gross building area{r.type === 'mixed-use' ? ` and ${fmt.int(AVG_UNIT_SF)} SF per apartment` : ''}.
        None of this property's own rents, leases or expenses are in it. Vs peers divides its estimate ÷ assessed by the median
        for its property type. Use it to choose where to look; underwrite before relying on a number.
      </Note>
    </Card>
  )
}

function LineTable({ line: l, heading }: { line: EstimateLine; heading?: string }) {
  const perUnit = l.benchmarkType === 'multifamily'
  const rows: [string, string, ReactNode?][] = [
    ...(l.area
      ? ([
          ['Gross building area', fmt.sf(l.area.gross.value), <SourceBadge data={l.area.gross} />],
          [`Rentable ${fmt.pctShort(l.area.efficiency.value)}`, fmt.sf(l.quantity.value), <SourceBadge data={l.area.efficiency} />],
        ] as [string, string, ReactNode][])
      : [[perUnit ? 'Units' : 'Rentable area', perUnit ? fmt.int(l.quantity.value) : fmt.sf(l.quantity.value), <SourceBadge data={l.quantity} />] as [string, string, ReactNode]]),
    ['Rent', perUnit ? fmt.rentPerUnit(l.rent.value) : fmt.rentPerSF(l.rent.value), <SourceBadge data={l.rent} />],
    ['Potential income', fmt.usd(l.potentialIncome)],
    [`Vacancy ${fmt.pct(l.vacancyRate.value)}`, `−${fmt.usd(l.vacancyLoss)}`, <SourceBadge data={l.vacancyRate} />],
    [
      `Expenses ${perUnit ? `${fmt.usd(l.opex.value)}/unit` : `${fmt.usdCents(l.opex.value)}/SF`}${l.leaseType ? `, ${LEASE_LABELS[l.leaseType]}` : ''}`,
      `−${fmt.usd(l.landlordOpex)}`,
      <SourceBadge data={l.opex} />,
    ],
    [`Management ${fmt.pct(QUICK_ASSUMPTIONS.managementFeePct, 0)}`, `−${fmt.usd(l.managementFee)}`],
    ['NOI', fmt.usd(l.noi)],
    [`÷ Cap rate ${fmt.pct(l.capRate.value, 2)}`, fmt.money(l.value), <SourceBadge data={l.capRate} />],
  ]
  return (
    <div className="rounded border border-slate-700/70 p-2">
      {heading && <div className="mb-1 text-[10px] font-semibold text-slate-300">{heading}</div>}
      <table className="w-full text-[10px] tabular-nums">
        <tbody>
          {rows.map(([label, value, badge]) => (
            <tr key={label} className={label === 'NOI' ? 'border-t border-slate-700 font-semibold' : ''}>
              <td className="py-px pr-1 text-slate-400">{label}</td>
              <td className="whitespace-nowrap py-px text-right text-slate-200">
                {value}
                {badge}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-slate-500">
        {l.market}
        {l.marketNote && ` (${l.marketNote})`}
      </div>
    </div>
  )
}
