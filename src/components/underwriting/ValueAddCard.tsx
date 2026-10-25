import { fmt } from '../../lib/format'
import type { ValueAddComparison } from '../../lib/underwriting/valueAdd'
import { Card } from '../ui/Card'

/** As-is vs Value-add at the same price, and the renovation pace by year; renders the comparison only, no math. */
export default function ValueAddCard({ comparison: c }: { comparison: ValueAddComparison }) {
  if (c.status === 'unavailable') {
    return (
      <Card title="Value-add plan">
        <p className="text-xs text-amber-300">{c.reason}</p>
      </Card>
    )
  }
  const pace = c.pace.filter((y) => y.units > 0)

  return (
    <Card title="Value-add plan" aside={<span className="text-[10px] text-slate-400">Same price as as-is</span>}>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th />
              <th className="pb-1.5 text-right font-medium">As-is</th>
              <th className="pb-1.5 text-right font-medium">Value-add</th>
              <th className="pb-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row) => (
              <tr key={row.key} className={`border-t border-slate-700/70 ${row.key === 'valueCreated' ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {row.label}
                </th>
                <td className="py-1.5 pl-2 text-right text-slate-400">{row.asIs.display}</td>
                <td className="py-1.5 pl-2 text-right font-semibold">{row.valueAdd.display}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right text-[11px] text-slate-400">{row.change?.display ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Renovation pace</h4>
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-1.5 text-left font-medium">Year</th>
                <th className="pb-1.5 text-right font-medium">Units</th>
                <th className="pb-1.5 text-right font-medium">Spend</th>
                <th className="pb-1.5 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {pace.map((y) => (
                <tr key={y.year} className="border-t border-slate-700/70 text-slate-300">
                  <td className="py-1.5">Year {y.year}</td>
                  <td className="py-1.5 text-right">{y.units}</td>
                  <td className="py-1.5 text-right">{fmt.usd(y.spend)}</td>
                  <td className="py-1.5 text-right">
                    {y.cumulativeUnits}
                    {y.cumulativeShare !== null && <span className="text-slate-500"> ({fmt.pctShort(y.cumulativeShare)})</span>}
                  </td>
                </tr>
              ))}
              {pace.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-1.5 text-slate-500">
                    No renovations within the hold.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">Finishes: {c.finish}</p>
        </div>
      </div>

      {(c.warnings.length > 0 || c.notes.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-[10px] leading-snug">
          {c.warnings.map((w) => (
            <p key={w} className="text-amber-300">
              {w}
            </p>
          ))}
          {c.notes.map((n) => (
            <p key={n} className="text-slate-500">
              {n}
            </p>
          ))}
        </div>
      )}
    </Card>
  )
}
