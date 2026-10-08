import { useMemo } from 'react'
import type { Property } from '../../types'
import { fmt } from '../../lib/format'
import { underwritingSummary, type NOIYear } from '../../lib/underwriting'
import { useAppStore } from '../../store/useAppStore'
import { Card, Note } from '../ui/Card'
import UnderwritingSummaryCard from '../underwriting/UnderwritingSummaryCard'

export default function InvestmentView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const summary = useMemo(() => underwritingSummary(p, asOf), [p, asOf])

  return (
    <div className="space-y-4">
      <UnderwritingSummaryCard summary={summary} />

      {summary.status === 'ok' && <NOIChart noiByYear={summary.noiByYear} />}
    </div>
  )
}

function NOIChart({ noiByYear }: { noiByYear: NOIYear[] }) {
  const maxNOI = Math.max(...noiByYear.map((y) => y.noi), 1)
  const anyRollover = noiByYear.some((y) => y.rollover)
  return (
    <Card
      title="NOI projection"
      aside={
        anyRollover && (
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="h-2 w-2 rounded-sm bg-amber-400/80" />
            Lease rollover year
          </span>
        )
      }
    >
      <div className="flex h-20 items-end gap-1">
        {noiByYear.map((y) => (
          <div key={y.year} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${y.rollover ? 'bg-amber-400/80' : 'bg-blue-500/80'}`}
              style={{ height: `${(Math.max(0, y.noi) / maxNOI) * 64}px` }}
              title={`Year ${y.year}: ${fmt.usdMillions(y.noi)}${y.rollover ? ' · rollover vacancy or free rent' : ''}`}
            />
            <span className="text-[9px] text-slate-500">{y.year}</span>
          </div>
        ))}
      </div>
      <Note>Engine NOI by hold year, base scenario: lease rollover, downtime, free rent and recoveries included.</Note>
    </Card>
  )
}
