import type { AssumptionGroup } from '../../lib/underwriting/fullView'
import { Card } from '../ui/Card'
import SourceBadge from '../ui/SourceBadge'

/** Read-only assumptions with their source badge and note. */
export default function AssumptionsTab({ groups }: { groups: AssumptionGroup[] }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Editing assumptions comes next.</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.title} title={g.title}>
            <table className="w-full border-collapse text-xs">
              <tbody>
                {g.items.map((x) => (
                  <tr key={x.label} className="border-t border-slate-700/70 first:border-t-0 align-top">
                    <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal text-slate-300">
                      {x.label}
                    </th>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold tabular-nums">
                      {x.value}
                      {x.src && <SourceBadge data={x.src} />}
                    </td>
                    <td className="py-1.5 text-[10px] leading-snug text-slate-500">{x.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </div>
  )
}
