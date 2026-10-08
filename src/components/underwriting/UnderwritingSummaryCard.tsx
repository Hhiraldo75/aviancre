import type { UnderwritingSummary } from '../../lib/underwriting'
import { fmt } from '../../lib/format'
import { Card, Chip, Stat, StatGrid } from '../ui/Card'

/** Base-scenario underwriting results; renders the mapped summary only, no math. */
export default function UnderwritingSummaryCard({ summary: s }: { summary: UnderwritingSummary }) {
  const aside =
    s.status === 'ok' ? (
      <div className="flex gap-1 text-[9px] font-semibold uppercase tracking-wide">
        <Chip>{fmt.label(s.scenario)} case</Chip>
        {s.isSample && <Chip tone="amber">Sample data</Chip>}
      </div>
    ) : undefined

  return (
    <Card title="Underwriting summary" aside={aside}>
      {s.status === 'unavailable' ? (
        <p className="rounded-md bg-amber-500/10 p-3 text-xs leading-snug text-amber-300">{s.reason}</p>
      ) : (
        <div className="space-y-4">
          {s.sections.map((section) => (
            <div key={section.title}>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</h4>
              <StatGrid>
                {section.stats.map((stat) => (
                  <Stat key={stat.label} {...stat} />
                ))}
              </StatGrid>
            </div>
          ))}
          {s.warnings.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Warnings</h4>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-amber-300 marker:text-amber-500">
                {s.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 border-t border-slate-700 pt-3">
        <span
          role="link"
          aria-disabled="true"
          title="Step 3: full cash flow, assumptions and sensitivities"
          className="cursor-not-allowed text-xs text-slate-500"
        >
          Full underwriting (coming soon) →
        </span>
      </div>
    </Card>
  )
}
