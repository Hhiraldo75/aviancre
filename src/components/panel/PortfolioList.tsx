import { fmt } from '../../lib/format'
import { occupancy, occupancyColor } from '../../lib/metrics'
import { useAppStore } from '../../store/useAppStore'
import { Stat } from '../ui/Card'

export default function PortfolioList() {
  const properties = useAppStore((s) => s.properties)
  const asOf = useAppStore((s) => s.asOf)
  const select = useAppStore((s) => s.select)

  const commercial = properties.filter((p) => p.rentRoll.kind === 'commercial')
  const totalRSF = commercial.reduce((s, p) => s + p.physical.rentableSF.value, 0)
  const leasedRSF = commercial.reduce((s, p) => s + p.physical.rentableSF.value * occupancy(p, asOf), 0)
  const units = properties.reduce((s, p) => s + (p.physical.unitCount?.value ?? 0), 0)

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
        <Stat label="Properties" value={fmt.int(properties.length)} />
        <Stat label="Commercial RSF" value={fmt.compact(totalRSF)} />
        <Stat label="Commercial leased" value={totalRSF ? fmt.pct(leasedRSF / totalRSF) : '—'} />
        <Stat label="Apartment units" value={fmt.int(units)} />
      </div>

      <p className="mt-4 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
        Click any building on the map to see its City of Providence public record.
      </p>

      <p className="mb-2 mt-5 text-[10px] uppercase tracking-wide text-slate-500">Sample properties</p>
      <ul className="-mx-2">
        {properties.map((p) => {
          const occ = occupancy(p, asOf)
          return (
            <li key={p.id}>
              <button
                onClick={() => select(p.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-slate-700/60"
              >
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: occupancyColor(occ) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-slate-400">
                    {fmt.label(p.assetType)} · Class {p.buildingClass} · {fmt.label(p.location.submarket)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm tabular-nums">{fmt.pct(occ, 0)}</span>
                  <span className="block text-[10px] text-slate-500">leased</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
