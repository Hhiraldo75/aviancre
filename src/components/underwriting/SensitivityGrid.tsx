import { useState } from 'react'
import type { SensitivityGrid as Grid, SensitivityMetric } from '../../types'
import { METRIC_LABELS, SENSITIVITY_CAPTION, sensitivityView, type SensitivityCellView } from '../../lib/underwriting/sensitivity'
import { Card, Note } from '../ui/Card'

const METRICS: SensitivityMetric[] = ['leveredIRR', 'unleveredIRR', 'equityMultiple']

/** emerald-500 / amber-500; alpha grows with distance from the center so text stays readable. */
const TONE_RGB = { better: '16 185 129', worse: '245 158 11' } as const

function shade(c: SensitivityCellView) {
  return c.tone ? { backgroundColor: `rgb(${TONE_RGB[c.tone]} / ${(0.08 + 0.37 * c.intensity).toFixed(3)})` } : undefined
}

/** A two-way grid of engine reruns; the outlined center cell is the current case. */
export default function SensitivityGrid({ title, grid }: { title: string; grid: Grid }) {
  const [metric, setMetric] = useState<SensitivityMetric>('leveredIRR')
  const v = sensitivityView(grid, metric)

  return (
    <Card
      title={title}
      aside={
        <div role="group" aria-label="Metric" className="flex rounded border border-slate-700 text-[10px]">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={`px-2 py-0.5 first:rounded-l last:rounded-r ${
                metric === m ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs tabular-nums">
          <caption className="sr-only">
            {METRIC_LABELS[metric]} by {v.rowTitle.toLowerCase()} (rows) and {v.columnTitle.toLowerCase()} (columns)
          </caption>
          <thead>
            <tr>
              <th className="pb-1 pr-2 text-left align-bottom text-[9px] font-medium uppercase tracking-wide text-slate-500">
                {v.rowTitle} ↓ · {v.columnTitle} →
              </th>
              {v.columns.map((c) => (
                <th key={c.value} scope="col" className="px-1 pb-1 text-right align-bottom font-medium">
                  <div className="text-slate-200">{c.value}</div>
                  <div className="text-[9px] font-normal text-slate-500">{c.delta}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => (
              <tr key={r.value}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium">
                  <span className="text-slate-200">{r.value}</span>
                  <span className="ml-1.5 text-[9px] font-normal text-slate-500">{r.delta}</span>
                </th>
                {v.cells[i].map((c, j) => (
                  <td
                    key={v.columns[j].value}
                    title={c.title}
                    style={shade(c)}
                    className={`rounded px-2 py-1.5 text-right ${
                      c.center ? 'font-semibold text-white ring-2 ring-inset ring-slate-200' : 'text-slate-100'
                    }`}
                  >
                    {c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>{SENSITIVITY_CAPTION}</Note>
    </Card>
  )
}
