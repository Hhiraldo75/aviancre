import type { LineItem, ReturnsView } from '../../lib/underwriting/fullView'
import { Card, Stat } from '../ui/Card'

/** Sources & uses, debt, sale and returns; renders mapped strings only. */
export default function ReturnsTab({ returns: r }: { returns: ReturnsView }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sources & uses">
          <div className="grid grid-cols-2 gap-6">
            <Lines title="Sources" items={r.sources} />
            <Lines title="Uses" items={r.uses} />
          </div>
        </Card>
        <Card title="Sale">
          <Lines items={r.sale} />
        </Card>
      </div>

      <Card title="Debt">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {r.debt.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
        <YearTable className="mt-4" columns={r.debtByYear.columns} rows={r.debtByYear.rows} />
      </Card>

      <Card title="Returns">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {r.returns.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
        <YearTable className="mt-4" columns={r.cashFlows.columns} rows={r.cashFlows.rows} />
      </Card>
    </div>
  )
}

function Lines({ title, items }: { title?: string; items: LineItem[] }) {
  return (
    <div>
      {title && <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>}
      <dl className="text-xs tabular-nums">
        {items.map((x) => (
          <div
            key={x.label}
            className={`flex justify-between gap-3 py-1 ${x.kind === 'total' ? 'border-t border-slate-600 font-semibold text-slate-100' : 'text-slate-300'}`}
          >
            <dt>{x.label}</dt>
            <dd>{x.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function YearTable({
  columns,
  rows,
  className = '',
}: {
  columns: string[]
  rows: { label: string; cells: string[] }[]
  className?: string
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="sticky left-0 bg-slate-900 py-1.5 pr-3 text-left font-medium" />
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-700/70 text-slate-300">
              <th scope="row" className="sticky left-0 whitespace-nowrap bg-slate-900 py-1.5 pr-3 text-left font-normal">
                {row.label}
              </th>
              {row.cells.map((c, i) => (
                <td key={columns[i]} className="whitespace-nowrap px-2 py-1.5 text-right">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
