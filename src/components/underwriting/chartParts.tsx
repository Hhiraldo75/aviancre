import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Hover/focus tooltip for the div-based charts: one target per year, the
 * tooltip centered over it and clamped so it stays inside the chart.
 */
export function useChartTooltip() {
  const [active, setActive] = useState<{ index: number; centerX: number } | null>(null)
  const [left, setLeft] = useState(0)
  const chartRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!active || !chartRef.current || !tipRef.current) return
    const max = chartRef.current.clientWidth - tipRef.current.offsetWidth
    setLeft(Math.min(Math.max(0, active.centerX - tipRef.current.offsetWidth / 2), Math.max(0, max)))
  }, [active])

  const hide = () => setActive(null)
  /** Props for a hover target; `text` is also its accessible label. */
  const target = (index: number, text: string) => {
    const show = (e: { currentTarget: HTMLElement }) =>
      setActive({ index, centerX: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 })
    return { tabIndex: 0, 'aria-label': text, onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide }
  }

  return { active: active?.index ?? null, left, chartRef, tipRef, target }
}

export function ChartTooltip({ tip, text }: { tip: ReturnType<typeof useChartTooltip>; text: ReactNode }) {
  return (
    <div
      ref={tip.tipRef}
      role="tooltip"
      style={{ left: tip.left }}
      className="pointer-events-none absolute top-0 z-10 w-max max-w-full rounded bg-slate-800 px-2 py-1 text-[10px] tabular-nums text-slate-100 shadow ring-1 ring-slate-700"
    >
      {text}
    </div>
  )
}

export function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-3 text-[10px] text-slate-400">{children}</div>
}
