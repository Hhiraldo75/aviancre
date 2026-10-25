import { useMemo, useState } from 'react'
import { SUBMARKETS } from '../../data/submarkets'
import { SCREENING_LABEL, SCREENING_TYPE_LABELS, SKIP_REASONS, type ScreeningType } from '../../lib/citywide/estimate'
import {
  BAND_COLORS,
  BAND_LEGEND,
  hasCitywideFilters,
  matchesCitywide,
  sortRows,
  type CitywideFilters,
  type CitywideSortKey,
  type MarketKey,
  type ScreeningRow,
} from '../../lib/citywide/view'
import { sfFromInput, sfToInput, toggleValue } from '../../lib/filters'
import { fmt } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import { NumberField, Toggle } from '../panel/FilterBar'

const PAGE = 100
const TYPES = Object.keys(SCREENING_TYPE_LABELS) as ScreeningType[]
const MARKETS: MarketKey[] = [...(Object.keys(SUBMARKETS) as MarketKey[]), 'metro']
const marketName = (m: MarketKey) => (m === 'metro' ? 'Metro (no submarket)' : SUBMARKETS[m].name)

const COLUMNS: { key: CitywideSortKey; label: string; numeric?: boolean }[] = [
  { key: 'address', label: 'Address' },
  { key: 'type', label: 'Type' },
  { key: 'market', label: 'Submarket' },
  { key: 'gba', label: 'Building SF', numeric: true },
  { key: 'value', label: 'Estimate', numeric: true },
  { key: 'assessed', label: 'Assessed', numeric: true },
  { key: 'ratio', label: 'Est. ÷ assessed', numeric: true },
  { key: 'peer', label: 'Vs peers', numeric: true },
]

/** "Where should an analyst look first?": every commercial lot, filtered and sorted, over the bottom of the map. */
export default function ScreeningList() {
  const citywide = useAppStore((s) => s.citywide)
  const filters = useAppStore((s) => s.citywideFilters)
  const sort = useAppStore((s) => s.citywideSort)
  const setFilter = useAppStore((s) => s.setCitywideFilter)
  const clearFilters = useAppStore((s) => s.clearCitywideFilters)
  const setSort = useAppStore((s) => s.setCitywideSort)
  const close = useAppStore((s) => s.setCitywideListOpen)
  const open = useAppStore((s) => s.openCitywideParcel)
  const parcel = useAppStore((s) => s.parcel)
  const [shown, setShown] = useState({ count: PAGE, for: '' })

  const rows = citywide.status === 'ready' ? citywide.rows : null
  const view = useMemo(() => (rows ? sortRows(rows.filter((r) => matchesCitywide(r, filters)), sort) : []), [rows, filters, sort])
  // Back to the first page whenever the filters or the sort change.
  const viewKey = JSON.stringify([filters, sort])
  const count = shown.for === viewKey ? shown.count : PAGE
  if (!rows) return null

  const selectedPin = parcel.status !== 'idle' ? parcel.picked?.pin : undefined
  const onSort = (key: CitywideSortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'address' || key === 'type' || key === 'market' ? 'asc' : 'desc' })

  return (
    <section
      aria-label="Screening list"
      className="absolute inset-x-3 bottom-3 z-20 flex h-[46%] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-700 px-4 py-2">
        <h2 className="text-sm font-semibold">Screening list</h2>
        <span className="text-xs text-slate-400">
          {fmt.int(view.length)} of {fmt.int(rows.length)} commercial lots
        </span>
        <span className="text-[11px] text-amber-300/90">{SCREENING_LABEL}: where to look first, not what it's worth</span>
        {hasCitywideFilters(filters) && (
          <button type="button" onClick={clearFilters} className="text-[11px] text-slate-400 underline hover:text-slate-100">
            Clear filters
          </button>
        )}
        <button type="button" onClick={() => close(false)} aria-label="Close the screening list" className="ml-auto text-lg leading-none text-slate-400 hover:text-slate-100">
          ×
        </button>
      </header>

      <Filters filters={filters} setFilter={setFilter} />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-3 py-1.5 font-semibold ${c.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button type="button" onClick={() => onSort(c.key)} className="uppercase hover:text-slate-100">
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.slice(0, count).map((r) => (
              <Row key={r.parcel.pin} row={r} selected={r.parcel.pin === selectedPin} onOpen={() => open(r.parcel.pin, true)} />
            ))}
          </tbody>
        </table>
        {view.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No lots match these filters.</p>}
        {view.length > count && (
          <button
            type="button"
            onClick={() => setShown({ count: count + PAGE, for: viewKey })}
            className="mx-auto my-2 block rounded-md bg-slate-700 px-3 py-1 text-xs font-medium hover:bg-slate-600"
          >
            Show {fmt.int(Math.min(PAGE, view.length - count))} more of {fmt.int(view.length - count)}
          </button>
        )}
      </div>
    </section>
  )
}

function Row({ row: r, selected, onOpen }: { row: ScreeningRow; selected: boolean; onOpen: () => void }) {
  const res = r.result
  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800 ${selected ? 'bg-blue-500/15' : ''}`}
      title="Show on the map with the public record"
    >
      <td className="px-3 py-1">
        {/* The click reaches the row; the button makes the row reachable by keyboard. */}
        <button type="button" className="text-left hover:text-blue-200">
          {r.parcel.address}
        </button>
      </td>
      <td className="px-3 py-1 text-slate-300">{r.type ? SCREENING_TYPE_LABELS[r.type] : '—'}</td>
      <td className="px-3 py-1 text-slate-300">{r.market === 'metro' ? 'Metro' : SUBMARKETS[r.market].name}</td>
      <td className="px-3 py-1 text-right">{r.parcel.gba ? fmt.int(r.parcel.gba) : '—'}</td>
      {res.status === 'skipped' ? (
        <td className="px-3 py-1 text-right text-slate-400" title={SKIP_REASONS[res.reason]}>
          No estimate
        </td>
      ) : (
        <td className="px-3 py-1 text-right">{fmt.money(res.value.value)}</td>
      )}
      <td className="px-3 py-1 text-right">{r.parcel.assessed ? fmt.money(r.parcel.assessed) : '—'}</td>
      {res.status === 'skipped' || r.band === 'skipped' ? (
        <td className="px-3 py-1 text-right text-[10px] text-slate-400" colSpan={2}>
          {res.status === 'skipped' ? SKIP_REASONS[res.reason] : ''}
        </td>
      ) : (
        <>
          <td className="px-3 py-1 text-right">{r.ratio !== undefined ? fmt.multiple(r.ratio) : '—'}</td>
          <td className="px-3 py-1 text-right">
            <span className="inline-flex items-center gap-1.5">
              {r.peerRatio !== undefined ? fmt.multiple(r.peerRatio) : '—'}
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/70" style={{ backgroundColor: BAND_COLORS[r.band] }} />
            </span>
          </td>
        </>
      )}
    </tr>
  )
}

function Filters({
  filters: f,
  setFilter,
}: {
  filters: CitywideFilters
  setFilter: <K extends keyof CitywideFilters>(key: K, value: CitywideFilters[K]) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-700 px-4 py-2 text-xs text-slate-400">
      <span className="flex flex-wrap items-center gap-1">
        {TYPES.map((t) => (
          <Toggle key={t} on={f.types.includes(t)} onClick={() => setFilter('types', toggleValue(f.types, t))}>
            {SCREENING_TYPE_LABELS[t]}
          </Toggle>
        ))}
      </span>
      <select
        aria-label="Submarket"
        value={f.markets[0] ?? ''}
        onChange={(e) => setFilter('markets', e.target.value ? [e.target.value as MarketKey] : [])}
        className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-slate-200"
      >
        <option value="">Any submarket</option>
        {MARKETS.map((m) => (
          <option key={m} value={m}>
            {marketName(m)}
          </option>
        ))}
      </select>
      <span className="flex items-center gap-1">
        Building SF
        <NumberField label="Minimum building SF" placeholder="Min" value={f.minSF} onChange={(v) => setFilter('minSF', v)} parse={sfFromInput} toText={sfToInput} />
        –
        <NumberField label="Maximum building SF" placeholder="Max" value={f.maxSF} onChange={(v) => setFilter('maxSF', v)} parse={sfFromInput} toText={sfToInput} />
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {BAND_LEGEND.map((b) => (
          <Toggle key={b.id} on={f.bands.includes(b.id)} onClick={() => setFilter('bands', toggleValue(f.bands, b.id))}>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: BAND_COLORS[b.id] }} />
              {b.label}
            </span>
          </Toggle>
        ))}
      </span>
      <select
        aria-label="Estimated or skipped"
        value={f.status}
        onChange={(e) => setFilter('status', e.target.value as CitywideFilters['status'])}
        className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-slate-200"
      >
        <option value="all">Estimated and skipped</option>
        <option value="estimated">Estimated only</option>
        <option value="skipped">Skipped only</option>
      </select>
    </div>
  )
}
