import type { ReturnsView } from '../../lib/underwriting/fullView'
import { fmt } from '../../lib/format'
import { Card, Note } from '../ui/Card'
import { ChartTooltip, Legend, Swatch, useChartTooltip } from './chartParts'

const PLOT_PX = 120
const STEP = 0.25
/** Height of the floor label, and how many years from the right edge it spans. */
const LABEL_PX = 14
const LABEL_POINTS = 3

/** DSCR by hold year against the 1.25x lender floor; years below it are amber. */
export default function DSCRChart({ chart }: { chart: ReturnsView['dscrChart'] }) {
  const tip = useChartTooltip()

  if (!chart) {
    return (
      <Card title="DSCR by year">
        <p className="text-xs text-slate-400">No debt is modeled, so there is no debt service to cover.</p>
      </Card>
    )
  }

  const { floor, points } = chart
  const dscrs = points.map((p) => p.dscr)
  const lo = Math.max(0, Math.floor((Math.min(...dscrs, 1) - 0.1) / STEP) * STEP)
  const hi = Math.ceil((Math.max(...dscrs, floor) + 0.1) / STEP) * STEP
  /** Percent from the top of the plot. */
  const y = (d: number) => ((hi - d) / (hi - lo)) * 100
  const x = (i: number) => ((i + 0.5) / points.length) * 100
  const tick = 'absolute right-1.5 -translate-y-1/2 text-[9px] tabular-nums'
  // The floor label sits at the right end, above the line unless the last points crowd that side.
  const band = ((hi - lo) * LABEL_PX) / PLOT_PX
  const near = dscrs.slice(-LABEL_POINTS)
  const labelBelow = near.some((d) => d >= floor && d <= floor + band) && !near.some((d) => d < floor && d >= floor - band)

  return (
    <Card
      title="DSCR by year"
      aside={
        <Legend>
          <Swatch className="bg-blue-400" label="DSCR" />
          <Swatch className="bg-amber-400" label={`Below ${fmt.multiple(floor)}`} />
        </Legend>
      }
    >
      <div className="flex">
        <div className="relative mt-6 w-9 shrink-0" style={{ height: PLOT_PX }} aria-hidden>
          <span className={`${tick} text-slate-500`} style={{ top: '0%' }}>
            {fmt.multiple(hi)}
          </span>
          <span className={`${tick} text-slate-300`} style={{ top: `${y(floor)}%` }}>
            {fmt.multiple(floor)}
          </span>
          <span className={`${tick} text-slate-500`} style={{ top: '100%' }}>
            {fmt.multiple(lo)}
          </span>
        </div>
        <div ref={tip.chartRef} className="relative min-w-0 flex-1 pt-6">
          {tip.active !== null && <ChartTooltip tip={tip} text={points[tip.active].tooltip} />}
          <div className="relative border-b border-l border-slate-700" style={{ height: PLOT_PX }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <polyline
                points={points.map((p, i) => `${x(i)},${y(p.dscr)}`).join(' ')}
                fill="none"
                stroke="#60a5fa"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-400" style={{ top: `${y(floor)}%` }}>
              <span
                className={`absolute right-1 rounded bg-slate-900/90 px-1 text-[9px] leading-3 text-slate-400 ${
                  labelBelow ? 'top-0.5' : 'bottom-0.5'
                }`}
              >
                Typical lender minimum
              </span>
            </div>
            {points.map((p, i) => (
              <span
                key={p.year}
                className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-900 ${
                  p.belowFloor ? 'bg-amber-400' : 'bg-blue-400'
                } ${tip.active === i ? 'h-3 w-3' : 'h-2 w-2'}`}
                style={{ left: `${x(i)}%`, top: `${y(p.dscr)}%` }}
              />
            ))}
            <div className="absolute inset-0 flex">
              {points.map((p, i) => (
                <div
                  key={p.year}
                  {...tip.target(i, p.tooltip)}
                  className={`flex-1 cursor-default outline-none focus-visible:ring-1 focus-visible:ring-slate-500 ${
                    tip.active === i ? 'bg-slate-700/30' : ''
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="mt-1 flex">
            {points.map((p) => (
              <span key={p.year} className="flex-1 text-center text-[9px] text-slate-500">
                {p.year}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Note>NOI ÷ debt service. Interest-only years carry lower debt service, so DSCR steps down when amortization starts.</Note>
    </Card>
  )
}
