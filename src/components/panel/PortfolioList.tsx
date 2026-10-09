import { SORT_KEYS, SORT_LABELS } from '../../lib/filters'
import { fmt } from '../../lib/format'
import { occupancy, occupancyColor } from '../../lib/metrics'
import { useAppStore, usePropertyView } from '../../store/useAppStore'
import { Stat } from '../ui/Card'
import FilterBar from './FilterBar'

export default function PortfolioList() {
  const asOf = useAppStore((s) => s.asOf)
  const select = useAppStore((s) => s.select)
  const sort = useAppStore((s) => s.sort)
  const setSort = useAppStore((s) => s.setSort)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const { matching: properties, total, facts } = usePropertyView()

  const commercial = properties.filter((p) => p.rentRoll.kind === 'commercial')
  const totalRSF = commercial.reduce((s, p) => s + p.physical.rentableSF.value, 0)
  const leasedRSF = commercial.reduce((s, p) => s + p.physical.rentableSF.value * occupancy(p, asOf), 0)
  const units = properties.reduce((s, p) => s + (p.physical.unitCount?.value ?? 0), 0)

  return (
    <div>
      <FilterBar />

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
        <Stat label="Properties" value={fmt.int(properties.length)} />
        <Stat label="Commercial RSF" value={fmt.compact(totalRSF)} />
        <Stat label="Commercial leased" value={totalRSF ? fmt.pct(leasedRSF / totalRSF) : '—'} />
        <Stat label="Apartment units" value={fmt.int(units)} />
      </div>

      <p className="mt-4 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
        Click any building on the map to see its City of Providence public record.
      </p>

      <div className="mb-2 mt-5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          {properties.length} of {total} sample properties
        </p>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(SORT_KEYS.find((k) => k === e.target.value) ?? 'name')}
            className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {properties.length === 0 && (
        <p className="py-4 text-center text-xs text-slate-400">
          No properties match the current filters.{' '}
          <button onClick={clearFilters} className="text-blue-300 underline hover:text-blue-200">
            Clear all
          </button>
        </p>
      )}

      <ul className="-mx-2">
        {properties.map((p) => {
          const occ = occupancy(p, asOf)
          const irr = facts[p.id]?.leveredIRR ?? null
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
                {sort === 'irr' ? (
                  <span className="text-right">
                    <span className="block text-sm tabular-nums">{irr === null ? '—' : fmt.pct(irr, 1)}</span>
                    <span className="block text-[10px] text-slate-500">lev. IRR</span>
                  </span>
                ) : sort === 'size' ? (
                  <span className="text-right">
                    <span className="block text-sm tabular-nums">{fmt.compact(p.physical.rentableSF.value)}</span>
                    <span className="block text-[10px] text-slate-500">RSF</span>
                  </span>
                ) : (
                  <span className="text-right">
                    <span className="block text-sm tabular-nums">{fmt.pct(occ, 0)}</span>
                    <span className="block text-[10px] text-slate-500">leased</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
