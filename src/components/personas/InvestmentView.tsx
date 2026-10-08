import { useMemo } from 'react'
import type { Property } from '../../types'
import { underwritingSummary } from '../../lib/underwriting'
import { useAppStore } from '../../store/useAppStore'
import NOIChart from '../underwriting/NOIChart'
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
