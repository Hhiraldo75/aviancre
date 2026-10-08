import { useLayoutEffect, useRef, useState } from 'react'
import type { NOIYear } from '../../lib/underwriting'
import { Card, Note } from '../ui/Card'

const CHART_PX = 64

/** NOI by hold year, stacked with income lost to lease rollover. */
export default function NOIChart({ noiByYear }: { noiByYear: NOIYear[] }) {
  const maxTotal = Math.max(...noiByYear.map((y) => Math.max(0, y.noi) + y.lostToRollover), 1)
  const px = (n: number) => (Math.max(0, n) / maxTotal) * CHART_PX

  const [active, setActive] = useState<{ index: number; centerX: number } | null>(null)
  const [left, setLeft] = useState(0)
  const chartRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  // Center the tooltip over the bar, clamped so it stays inside the chart.
  useLayoutEffect(() => {
    if (!active || !chartRef.current || !tipRef.current) return
    const max = chartRef.current.clientWidth - tipRef.current.offsetWidth
    setLeft(Math.min(Math.max(0, active.centerX - tipRef.current.offsetWidth / 2), Math.max(0, max)))
  }, [active])

  const show = (index: number) => (e: { currentTarget: HTMLElement }) =>
    setActive({ index, centerX: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 })
  const hide = () => setActive(null)

  return (
    <Card
      title="NOI projection"
      aside={
        <div className="flex gap-3 text-[10px] text-slate-400">
          <Swatch className="bg-blue-500/80" label="NOI" />
          <Swatch className="bg-amber-400/80" label="Lost to lease rollover" />
        </div>
      }
    >
      <div ref={chartRef} className="relative pt-6">
        {active && (
          <div
            ref={tipRef}
            role="tooltip"
            style={{ left }}
            className="pointer-events-none absolute top-0 w-max max-w-full rounded bg-slate-800 px-2 py-1 text-[10px] tabular-nums text-slate-100 shadow ring-1 ring-slate-700"
          >
            {noiByYear[active.index].tooltip}
          </div>
        )}
        <div className="flex h-20 items-end gap-1">
          {noiByYear.map((y, i) => (
            <div
              key={y.year}
              tabIndex={0}
              aria-label={y.tooltip}
              onMouseEnter={show(i)}
              onFocus={show(i)}
              onMouseLeave={hide}
              onBlur={hide}
              className="flex flex-1 cursor-default flex-col items-center gap-1 outline-none focus-visible:ring-1 focus-visible:ring-slate-500"
            >
              <div className={`flex w-full flex-col ${active?.index === i ? 'opacity-100' : 'opacity-90'}`}>
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

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${className}`} />
      {label}
    </span>
  )
}
