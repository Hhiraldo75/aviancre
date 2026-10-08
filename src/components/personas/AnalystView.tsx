import type { Property } from '../../types'
import { SALE_COMPS } from '../../data/saleComps'
import { SUBMARKETS, TREND_SOURCE } from '../../data/submarkets'
import { fmt } from '../../lib/format'
import { markToMarket } from '../../lib/metrics'
import { quickFinancials } from '../../lib/quickFinancials'
import { useAppStore } from '../../store/useAppStore'
import { Card, Note, Stat, StatGrid } from '../ui/Card'
import SourceBadge from '../ui/SourceBadge'

export default function AnalystView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const submarket = SUBMARKETS[p.location.submarket]
  const lookupType = p.assetType === 'mixed-use' ? 'office' : p.assetType
  const trend = submarket.trends?.[lookupType] ?? []
  const isMF = p.assetType === 'multifamily'
  const rent = (n: number) => (isMF ? fmt.rentPerUnit(n) : fmt.rentPerSF(n))

  const comps = SALE_COMPS.filter((c) => c.assetType === p.assetType).sort((a, b) => {
    const sameA = a.submarket === p.location.submarket ? 0 : 1
    const sameB = b.submarket === p.location.submarket ? 0 : 1
    return sameA - sameB || b.saleDate.localeCompare(a.saleDate)
  })
  const avgCompCap = comps.length ? comps.reduce((s, c) => s + c.capRate, 0) / comps.length : null
  const q = quickFinancials(p, asOf)
  const mtm = markToMarket(p, asOf)

  const first = trend[0]
  const last = trend[trend.length - 1]

  return (
    <div className="space-y-4">
      <Card title={`Submarket trends · ${submarket.name}`} aside={<SourceBadge data={{ source: 'estimated', sourceName: TREND_SOURCE }} />}>
        {first && last && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="Rent since 2022" value={fmt.signedPct(last.marketRent / first.marketRent - 1)} />
            <Stat label="Vacancy chg" value={`${((last.vacancyRate - first.vacancyRate) * 100).toFixed(1)} pts`} />
            <Stat label="Cap rate chg" value={`${((last.capRate - first.capRate) * 10000).toFixed(0)} bps`} />
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-1 font-medium">Year</th>
              <th className="pb-1 text-right font-medium">Mkt rent</th>
              <th className="pb-1 font-medium pl-3">Vacancy</th>
              <th className="pb-1 text-right font-medium">Cap</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.year} className="border-t border-slate-700/70">
                <td className="py-1 tabular-nums">{t.year}</td>
                <td className="py-1 text-right tabular-nums">{isMF ? fmt.usd(t.marketRent) : `$${t.marketRent.toFixed(2)}`}</td>
                <td className="py-1 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-slate-700">
                      <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (t.vacancyRate / 0.25) * 100)}%` }} />
                    </div>
                    <span className="tabular-nums">{fmt.pct(t.vacancyRate)}</span>
                  </div>
                </td>
                <td className="py-1 text-right tabular-nums">{fmt.pct(t.capRate, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Cap rates & value">
        <StatGrid>
          <Stat label="Market cap rate" value={fmt.pct(p.market.marketCapRate.value, 2)} src={p.market.marketCapRate} />
          <Stat label="Avg comp cap" value={avgCompCap !== null ? fmt.pct(avgCompCap, 2) : '—'} />
          <Stat label="Year-1 NOI (quick)" value={fmt.usdCompact(q.noi)} />
          <Stat label="Implied value" value={fmt.usdCompact(q.impliedValue)} hint="NOI ÷ market cap" />
          <Stat label="Market rent" value={rent(p.market.marketRent.value)} src={p.market.marketRent} />
          <Stat
            label="Mark-to-market"
            value={mtm !== null ? fmt.signedPct(mtm) : '—'}
            hint={mtm !== null && mtm > 0 ? 'In-place below market' : undefined}
            tone="good"
          />
        </StatGrid>
      </Card>

      <Card title={`Historical sale comps · ${fmt.label(p.assetType)}`} aside={<SourceBadge data={{ source: 'estimated', sourceName: 'Sample comps (fictional)' }} />}>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-1 font-medium">Property / date</th>
              <th className="pb-1 text-right font-medium">{isMF ? '$/unit' : '$/SF'}</th>
              <th className="pb-1 text-right font-medium">Cap</th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.id} className="border-t border-slate-700/70">
                <td className="py-1.5 pr-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-[10px] text-slate-500">
                    {fmt.monthYear(c.saleDate)} · {SUBMARKETS[c.submarket].name}
                    {c.submarket === p.location.submarket ? ' · same submarket' : ''}
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {isMF && c.units ? fmt.usdCompact(c.price / c.units) : `$${(c.price / c.sf).toFixed(0)}`}
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmt.pct(c.capRate, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {p.locationContext && (
        <Card title="Trade area">
          <div className="mb-3 space-y-1 text-xs">
            {p.locationContext.trafficCounts.map((t) => (
              <div key={t.road} className="flex justify-between">
                <span>
                  {t.road}
                  {t.distanceFt ? <span className="text-slate-500"> · {fmt.int(t.distanceFt)} ft</span> : null}
                </span>
                <span className="tabular-nums">
                  {fmt.int(t.aadt.value)} AADT
                  <SourceBadge data={t.aadt} />
                </span>
              </div>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-1 font-medium">Ring</th>
                <th className="pb-1 text-right font-medium">Pop.</th>
                <th className="pb-1 text-right font-medium">Med. HH inc.</th>
                <th className="pb-1 text-right font-medium">5-yr growth</th>
              </tr>
            </thead>
            <tbody>
              {p.locationContext.demographics.map((d) => (
                <tr key={d.radiusMiles} className="border-t border-slate-700/70">
                  <td className="py-1">{d.radiusMiles} mi</td>
                  <td className="py-1 text-right tabular-nums">{fmt.compact(d.population.value)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt.usdCompact(d.medianHouseholdIncome.value)}</td>
                  <td className="py-1 text-right tabular-nums">{d.populationGrowth5Yr ? fmt.pct(d.populationGrowth5Yr.value) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>Traffic and demographics are placeholders until RIDOT counts and Census ACS data are loaded.</Note>
        </Card>
      )}
    </div>
  )
}
