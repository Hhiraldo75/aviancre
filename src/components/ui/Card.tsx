import type { ReactNode } from 'react'
import type { Sourced } from '../../types'
import SourceBadge from './SourceBadge'

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  src,
  hint,
  tone,
}: {
  label: string
  value: string
  src?: Sourced<unknown>
  hint?: string
  tone?: 'good' | 'warn'
}) {
  const hintColor = tone === 'warn' ? 'text-amber-300' : 'text-emerald-400'
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value}
        {src && <SourceBadge data={src} />}
      </div>
      {hint && <div className={`text-[10px] ${hintColor}`}>{hint}</div>}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
}

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' }) {
  const cls = tone === 'amber' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-200'
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{children}</span>
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[10px] leading-snug text-slate-500">{children}</p>
}
