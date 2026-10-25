import { SCREENING_LABEL } from '../../lib/citywide/estimate'
import { BAND_COLORS, BAND_LEGEND, SKIPPED_COLOR } from '../../lib/citywide/view'
import { hasActiveFilters } from '../../lib/filters'
import { FILTERED_OUT_COLOR } from '../../lib/geo'
import { OCCUPANCY_BUCKETS } from '../../lib/metrics'
import { useAppStore } from '../../store/useAppStore'

export default function MapLegend() {
  const filtered = useAppStore((s) => hasActiveFilters(s.filters))
  const citywide = useAppStore((s) => s.citywideVisible && s.citywide.status === 'ready')
  return (
    <div className="pointer-events-none absolute bottom-6 left-4 rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur">
      {citywide && (
        <div className="mb-2 border-b border-slate-700 pb-2">
          <div className="font-semibold">Citywide: estimate ÷ assessed,</div>
          <div className="font-semibold">relative to similar properties</div>
          <div className="text-[10px] text-slate-400">1.0× = the median parcel of the same type</div>
          <div className="mb-1 text-[10px] text-amber-300/90">{SCREENING_LABEL}</div>
          {BAND_LEGEND.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border border-white/70" style={{ backgroundColor: BAND_COLORS[b.id] }} />
              {b.label}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: SKIPPED_COLOR, backgroundColor: '#e7e5e4' }} />
            No estimate (see the parcel)
          </div>
          <div className="mt-1 text-[10px] text-slate-400">Faint: outside the screening list's filters</div>
        </div>
      )}
      <div className="mb-1 font-semibold">Occupancy</div>
      {OCCUPANCY_BUCKETS.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: b.color }} />
          {b.label}
        </div>
      ))}
      {filtered && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: FILTERED_OUT_COLOR }} />
          Outside filters
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm bg-blue-500" />
        Selected
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm border-2 border-blue-600 bg-blue-500/20" />
        Public parcel
      </div>
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 12 16" className="h-3.5 w-3 shrink-0" aria-hidden>
          <path d="M6 15.5C6 15.5 1 9.6 1 6a5 5 0 0 1 10 0c0 3.6-5 9.5-5 9.5Z" fill="#94a3b8" stroke="#fff" />
          <circle cx="6" cy="6" r="1.8" fill="#0f172a" />
        </svg>
        Deal, location approximate
      </div>
      <div className="mt-1 text-[10px] text-slate-400">Colored buildings: sample data on real footprints</div>
    </div>
  )
}
