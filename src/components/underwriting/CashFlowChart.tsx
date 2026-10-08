import type { CashFlowBar } from '../../lib/underwriting/fullView'
import { Card, Note } from '../ui/Card'
import { ChartTooltip, Legend, Swatch, useChartTooltip } from './chartParts'

const PLOT_PX = 120
/** One blue ramp, darkest first: each line is the one before it less more costs. */
const SERIES = [
  ['noi', 'NOI', 'bg-blue-500'],
  ['beforeDebt', 'Cash flow before debt', 'bg-blue-300'],
  ['afterDebt', 'Cash flow after debt', 'bg-blue-100'],
] as const

/** NOI and cash flow before and after debt by hold year, grouped; negative years drop below the zero line. */
export default function CashFlowChart({ years }: { years: CashFlowBar[] }) {
  const values = years.flatMap((y) => SERIES.map(([key]) => y[key]))
  const maxPos = Math.max(0, ...values)
  const maxNeg = Math.max(0, ...values.map((v) => -v))
  const scale = PLOT_PX / (maxPos + maxNeg || 1)
  const posPx = maxPos * scale
  const tip = useChartTooltip()

  return (
    <Card
      title="Cash flow by year"
      aside={
        <Legend>
          {SERIES.map(([key, label, color]) => (
            <Swatch key={key} className={color} label={label} />
          ))}
        </Legend>
      }
    >
      <div ref={tip.chartRef} className="relative pt-6">
        {tip.active !== null && <ChartTooltip tip={tip} text={years[tip.active].tooltip} />}
        <div className="relative flex gap-2">
          <div className="pointer-events-none absolute inset-x-0 border-t border-slate-600" style={{ top: posPx }} />
          {years.map((y, i) => (
            <div
              key={y.year}
              {...tip.target(i, y.tooltip)}
              className="flex flex-1 cursor-default flex-col items-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-slate-500"
            >
              <div className={`flex w-full gap-0.5 ${tip.active === i ? 'opacity-100' : 'opacity-90'}`} style={{ height: PLOT_PX }}>
                {SERIES.map(([key, , color]) => {
                  const v = y[key]
                  return (
                    <div key={key} className="flex flex-1 flex-col">
                      <div className="flex items-end" style={{ height: posPx }}>
                        {v > 0 && <div className={`w-full rounded-t ${color}`} style={{ height: v * scale }} />}
                      </div>
                      <div className="flex-1">{v < 0 && <div className={`w-full rounded-b ${color}`} style={{ height: -v * scale }} />}</div>
                    </div>
                  )
                })}
              </div>
              <span className="text-[9px] text-slate-500">{y.year}</span>
            </div>
          ))}
        </div>
      </div>
      <Note>Hold years. Before debt is NOI less TI, leasing commissions and reserves; after debt also subtracts debt service.</Note>
    </Card>
  )
}
