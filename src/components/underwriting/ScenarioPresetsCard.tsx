import type { PresetRow } from '../../lib/underwriting/scenarios'
import { SCENARIO_LABELS, STRESS_SCENARIOS } from '../../lib/underwriting/scenarios'
import { Card } from '../ui/Card'
import { AssumptionInput, type Handlers } from './AssumptionsTab'

/** The Downside and Upside presets: how far each moves an assumption from Base. Edits recalculate the scenarios as you type. */
export default function ScenarioPresetsCard({
  rows,
  changed,
  onResetAll,
  ...handlers
}: { rows: PresetRow[]; changed: boolean; onResetAll: () => void } & Handlers) {
  return (
    <Card
      title="Scenarios"
      aside={
        <button
          type="button"
          onClick={onResetAll}
          disabled={!changed}
          className="shrink-0 rounded border border-slate-600 px-2.5 py-1 text-xs normal-case text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Reset presets
        </button>
      }
    >
      <p className="-mt-1 mb-2 text-[10px] leading-snug text-slate-500">
        Downside and Upside move these assumptions from Base, after your edits above; the purchase price stays at Base. Changes are in
        percentage points (pts), basis points (bps), months, or for market rent a percent of the value. Upside general vacancy stops at
        3%, and every result stays within the assumption’s allowed range.
      </p>
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[35%]" />
          <col />
        </colgroup>
        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="pb-1 text-left font-medium">Assumption (Base)</th>
            {STRESS_SCENARIOS.map((s) => (
              <th key={s} className="pb-1 text-left font-medium">
                {SCENARIO_LABELS[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-700/70 align-top">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-300">
                {row.label}
                <div className="text-[10px] text-slate-500">{row.current}</div>
              </th>
              {STRESS_SCENARIOS.map((s) => {
                const x = row.inputs[s]
                return (
                  <td key={s} className="py-1.5 pr-3">
                    <AssumptionInput key={x.edit.field.key} label={x.edit.field.label} edit={x.edit} src={x.src} {...handlers} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
