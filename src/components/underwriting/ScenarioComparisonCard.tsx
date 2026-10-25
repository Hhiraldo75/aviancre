import type { Scenario } from '../../types'
import { SCENARIO_LABELS, SCENARIOS, STRESS_SCENARIOS, type ScenarioComparison } from '../../lib/underwriting/scenarios'
import { Card } from '../ui/Card'
import SourceBadge from '../ui/SourceBadge'

const TONES = { better: 'text-emerald-400', worse: 'text-amber-300' } as const

/** Base, Downside and Upside side by side at the Base price; renders the mapped comparison only, no math. */
export default function ScenarioComparisonCard({
  comparison: c,
  onView,
  onEditPresets,
}: {
  comparison: ScenarioComparison
  onView: (scenario: Scenario) => void
  onEditPresets: () => void
}) {
  // The summary card already explains why a property can't be underwritten.
  if (c.status === 'unavailable') return null

  return (
    <Card title="Scenarios" aside={<span className="text-[10px] text-slate-400">Price held at {c.price.display}</span>}>
      <table className="w-full table-fixed border-collapse text-[11px] tabular-nums">
        <colgroup>
          <col className="w-[31%]" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide">
            <th />
            {SCENARIOS.map((s) => (
              <th key={s} className="pb-1.5 text-right font-medium">
                <button
                  type="button"
                  onClick={() => onView(s)}
                  title={`Full underwriting, ${SCENARIO_LABELS[s]} case`}
                  className="uppercase tracking-wide text-sky-300 hover:text-sky-200"
                >
                  {SCENARIO_LABELS[s]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-700/70 align-top">
              <th scope="row" className="py-1.5 pr-1 text-left font-normal leading-tight text-slate-300">
                {row.label}
              </th>
              {SCENARIOS.map((s) => {
                const cell = row.cells[s]
                return (
                  <td key={s} title={cell.hint ?? cell.vsBase?.display} className="py-1.5 pl-1 text-right">
                    <div className="font-semibold">{cell.display}</div>
                    {cell.vsBase && <div className={`text-[10px] ${cell.tone ? TONES[cell.tone] : 'text-slate-500'}`}>{cell.vsBase.short}</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-[10px] leading-snug text-slate-400">
        {STRESS_SCENARIOS.map((s) => {
          const items = c.presets[s].filter((p) => p.delta.value !== 0 || p.edited)
          const estimated = c.presets[s].find((p) => !p.edited)
          return (
            <p key={s}>
              <span className="font-semibold text-slate-300">{SCENARIO_LABELS[s]}:</span>{' '}
              {items.length === 0
                ? 'no changes'
                : items.map((p, i) => (
                    <span key={p.key} title={[p.applied, p.note, p.edited ? 'Your preset' : p.delta.sourceName].filter(Boolean).join('\n')}>
                      {i > 0 && ' · '}
                      <span className={p.edited ? 'text-violet-300' : undefined}>
                        {p.label.toLowerCase()} {p.display}
                      </span>
                    </span>
                  ))}
              {estimated && <SourceBadge data={estimated.delta} />}
            </p>
          )
        })}
        {c.notes.slice(1).map((n) => (
          <p key={n} className="text-slate-500">
            {n}
          </p>
        ))}
      </div>

      <div className="mt-3 border-t border-slate-700 pt-3">
        <button type="button" onClick={onEditPresets} className="text-xs font-medium text-sky-300 hover:text-sky-200">
          Edit presets →
        </button>
      </div>
    </Card>
  )
}
