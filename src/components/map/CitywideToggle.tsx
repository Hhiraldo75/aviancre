import { SCREENING_LABEL } from '../../lib/citywide/estimate'
import { fmt } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'

/** The "Citywide estimates" switch over the map; nothing is fetched until it is first turned on. */
export default function CitywideToggle() {
  const visible = useAppStore((s) => s.citywideVisible)
  const citywide = useAppStore((s) => s.citywide)
  const toggle = useAppStore((s) => s.toggleCitywide)
  const listOpen = useAppStore((s) => s.citywideListOpen)
  const setListOpen = useAppStore((s) => s.setCitywideListOpen)
  const on = visible && citywide.status !== 'error'

  return (
    <div className="absolute left-4 top-4 z-10 w-60 rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur">
      <button type="button" role="switch" aria-checked={on} onClick={toggle} className="flex w-full items-center justify-between gap-2 font-semibold">
        Citywide estimates
        <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-blue-500' : 'bg-slate-600'}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
        </span>
      </button>
      <p className="mt-0.5 text-[10px] text-amber-300/90">{SCREENING_LABEL}</p>

      {visible && citywide.status === 'loading' && <p className="mt-1.5 text-slate-400">Loading the commercial parcels…</p>}
      {visible && citywide.status === 'error' && (
        <p className="mt-1.5 text-red-300">
          Couldn't load the estimates: {citywide.message}.{' '}
          <button type="button" onClick={toggle} className="underline hover:text-red-100">
            Try again
          </button>
        </p>
      )}
      {visible && citywide.status === 'ready' && (
        <>
          <p className="mt-1.5 text-slate-400">
            {fmt.int(citywide.meta.coverage.estimated)} of {fmt.int(citywide.meta.coverage.inSnapshot)} commercial lots estimated · public data as
            of {fmt.date(citywide.meta.generatedAt)}
          </p>
          <button
            type="button"
            onClick={() => setListOpen(!listOpen)}
            className="mt-1.5 w-full rounded-md bg-slate-700 px-2 py-1 font-medium hover:bg-slate-600"
          >
            {listOpen ? 'Close screening list' : 'Open screening list'}
          </button>
        </>
      )}
    </div>
  )
}
