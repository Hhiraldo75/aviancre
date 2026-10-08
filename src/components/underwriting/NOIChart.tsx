import type { NOIYear } from '../../lib/underwriting'
import { Card, Note } from '../ui/Card'
import { ChartTooltip, Legend, Swatch, useChartTooltip } from './chartParts'

const CHART_PX = 64

/** NOI by hold year, stacked with income lost to lease rollover. */
export default function NOIChart({ noiByYear }: { noiByYear: NOIYear[] }) {
  const maxTotal = Math.max(...noiByYear.map((y) => Math.max(0, y.noi) + y.lostToRollover), 1)
  const px = (n: number) => (Math.max(0, n) / maxTotal) * CHART_PX
  const tip = useChartTooltip()

  return (
    <Card
      title="NOI projection"
      aside={
        <Legend>
          <Swatch className="bg-blue-500/80" label="NOI" />
          <Swatch className="bg-amber-400/80" label="Lost to lease rollover" />
        </Legend>
      }
    >
      <div ref={tip.chartRef} className="relative pt-6">
        {tip.active !== null && <ChartTooltip tip={tip} text={noiByYear[tip.active].tooltip} />}
        <div className="flex h-20 items-end gap-1">
          {noiByYear.map((y, i) => (
            <div
              key={y.year}
              {...tip.target(i, y.tooltip)}
              className="flex flex-1 cursor-default flex-col items-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-slate-500"
            >
              <div className={`flex w-full flex-col ${tip.active === i ? 'opacity-100' : 'opacity-90'}`}>
                {y.lostToRollover > 0 && <div className="w-full rounded-t bg-amber-400/80" style={{ height: `${px(y.lostToRollover)}px` }} />}
                <div className={`w-full bg-blue-500/80 ${y.lostToRollover > 0 ? '' : 'rounded-t'}`} style={{ height: `${px(y.noi)}px` }} />
              </div>
              <span className="text-[9px] text-slate-500">{y.year}</span>
            </div>
          ))}
        </div>
      </div>
      <Note>Engine NOI by hold year, base scenario. Amber is absorption/turnover vacancy plus free rent that year.</Note>
    </Card>
  )
}
