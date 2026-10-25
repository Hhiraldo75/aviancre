import { useMemo } from 'react'
import type { Property } from '../../types'
import { underwritingSummary } from '../../lib/underwriting'
import { scenarioComparison } from '../../lib/underwriting/scenarios'
import { useAppStore, useAssumptionEdits } from '../../store/useAppStore'
import NOIChart from '../underwriting/NOIChart'
import ScenarioComparisonCard from '../underwriting/ScenarioComparisonCard'
import T12Card from '../underwriting/T12Card'
import UnderwritingSummaryCard from '../underwriting/UnderwritingSummaryCard'

export default function InvestmentView({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const openUnderwriting = useAppStore((s) => s.openUnderwriting)
  const edits = useAssumptionEdits(p.id)
  const summary = useMemo(() => underwritingSummary(p, asOf, edits), [p, asOf, edits])
  const scenarios = useMemo(() => scenarioComparison(p, asOf, edits), [p, asOf, edits])

  return (
    <div className="space-y-4">
      <UnderwritingSummaryCard summary={summary} onOpenFull={() => openUnderwriting()} />

      <T12Card property={p} />

      <ScenarioComparisonCard
        comparison={scenarios}
        onView={(scenario) => openUnderwriting('Cash flow', scenario)}
        onEditPresets={() => openUnderwriting('Assumptions')}
      />

      {summary.status === 'ok' && <NOIChart noiByYear={summary.noiByYear} />}
    </div>
  )
}
