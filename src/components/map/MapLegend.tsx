import { OCCUPANCY_BUCKETS } from '../../lib/metrics'

export default function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-4 rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur">
      <div className="mb-1 font-semibold">Occupancy</div>
      {OCCUPANCY_BUCKETS.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: b.color }} />
          {b.label}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm bg-blue-500" />
        Selected
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm border-2 border-blue-600 bg-blue-500/20" />
        Public parcel
      </div>
      <div className="mt-1 text-[10px] text-slate-400">Colored blocks: sample data · placeholder massing</div>
    </div>
  )
}
