import type { ExpirationBar } from '../../lib/underwriting/fullView'
import { Card, Note } from '../ui/Card'
import { ChartTooltip, Legend, Swatch, useChartTooltip } from './chartParts'

const PLOT_PX = 96
/** Room for the 2px gap between stacked segments. */
const GAP_PX = 2

/** SF expiring per hold year: in-place leases solid, modeled re-leased space lighter on top. */
export default function ExpirationChart({ years }: { years: ExpirationBar[] }) {
  const max = Math.max(...years.map((y) => y.inPlaceSF + y.releasedSF), 1)
  const px = (sf: number) => (sf / max) * (PLOT_PX - GAP_PX)
  const tip = useChartTooltip()

  return (
    <Card
      title="Lease expirations"
      aside={
        <Legend>
          <Swatch className="bg-blue-500" label="In-place leases" />
          <Swatch className="bg-blue-300" label="Re-leased space" />
        </Legend>
      }
    >
      <div ref={tip.chartRef} className="relative pt-6">
        {tip.active !== null && <ChartTooltip tip={tip} text={years[tip.active].tooltip} />}
        <div className="flex items-end gap-1 border-b border-slate-700" style={{ height: PLOT_PX }}>
          {years.map((y, i) => (
            <div
              key={y.year}
              {...tip.target(i, y.tooltip)}
              className={`flex h-full flex-1 cursor-default flex-col justify-end outline-none focus-visible:ring-1 focus-visible:ring-slate-500 ${
                tip.active === i ? 'opacity-100' : 'opacity-90'
              }`}
            >
              {y.releasedSF > 0 && <div className="w-full rounded-t bg-blue-300" style={{ height: px(y.releasedSF) }} />}
              {y.inPlaceSF > 0 && (
                <div
                  className={`w-full bg-blue-500 ${y.releasedSF > 0 ? 'mt-0.5' : 'rounded-t'}`}
                  style={{ height: px(y.inPlaceSF) }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {years.map((y) => (
            <span key={y.year} className="flex-1 text-center text-[9px] text-slate-500">
              {y.year}
            </span>
          ))}
        </div>
      </div>
      <Note>SF whose lease ends in each hold year. Re-leased space is modeled leasing that rolls again within the hold.</Note>
    </Card>
  )
}
