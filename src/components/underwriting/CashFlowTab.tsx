import type { CashFlowTable } from '../../lib/underwriting/fullView'

/** Annual cash flow statement; sticky line labels, horizontal scroll for the years. */
export default function CashFlowTab({ table, onDownload }: { table: CashFlowTable; onDownload: () => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-400">
          USD. Costs and losses in parentheses. Year {table.exitYear} is modeled only to value the exit; the normalized
          column replaces rollover vacancy and free rent with general vacancy and is the NOI the sale uses.
        </p>
        <button
          type="button"
          onClick={onDownload}
          className="shrink-0 rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-slate-700">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-medium">Line</th>
              {table.columns.map((c, i) => (
                <th
                  key={c}
                  className={`whitespace-nowrap px-2 py-2 text-right font-medium ${i === table.columns.length - 2 ? 'border-l border-slate-700' : ''}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => {
              const subtotal = row.kind === 'subtotal'
              return (
                <tr
                  key={row.key}
                  className={`${subtotal ? 'border-t border-slate-600 font-semibold text-slate-100' : 'text-slate-300'} ${
                    row.kind === 'detail' ? 'text-slate-500' : ''
                  }`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 whitespace-nowrap bg-slate-900 px-3 py-1.5 text-left ${
                      subtotal ? 'font-semibold' : 'font-normal'
                    } ${row.kind === 'detail' ? 'pl-6 italic' : ''}`}
                  >
                    {row.label}
                  </th>
                  {row.cells.map((c, i) => (
                    <td
                      key={table.columns[i]}
                      className={`whitespace-nowrap px-2 py-1.5 text-right ${i === table.columns.length - 2 ? 'border-l border-slate-700' : ''}`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
