import { useMemo } from 'react'
import type { Property } from '../../types'
import { underwritingSummary } from '../../lib/underwriting'
import { useAppStore, useAssumptionEdits } from '../../store/useAppStore'
import NOIChart from '../underwriting/NOIChart'
import UnderwritingSummaryCard from '../underwriting/UnderwritingSummaryCard'

export default function InvestmentView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const openUnderwriting = useAppStore((s) => s.openUnderwriting)
  const edits = useAssumptionEdits(p.id)
  const summary = useMemo(() => underwritingSummary(p, asOf, edits), [p, asOf, edits])

  return (
    <div className="space-y-4">
      <UnderwritingSummaryCard summary={summary} onOpenFull={() => openUnderwriting()} />

      {summary.status === 'ok' && <NOIChart noiByYear={summary.noiByYear} />}
    </div>
  )
}
