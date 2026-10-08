import { useMemo } from 'react'
import type { Property } from '../../types'
import { fmt } from '../../lib/format'
import { underwritingSummary } from '../../lib/underwriting'
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

function NOIChart({ noiByYear }: { noiByYear: number[] }) {
  const maxNOI = Math.max(...noiByYear, 1)
  return (
    <Card title="NOI projection">
      <div className="flex h-20 items-end gap-1">
        {noiByYear.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t bg-blue-500/80" style={{ height: `${(Math.max(0, n) / maxNOI) * 64}px` }} title={`Year ${i + 1}: ${fmt.usd(n)}`} />
            <span className="text-[9px] text-slate-500">{i + 1}</span>
          </div>
        ))}
      </div>
      <Note>Engine NOI by hold year, base scenario: lease rollover, downtime, free rent and recoveries included.</Note>
    </Card>
  )
}
