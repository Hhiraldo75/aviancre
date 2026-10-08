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
  const hintColor = tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-400' : 'text-slate-400'
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

const CHIP_TONES = {
  slate: 'bg-slate-700 text-slate-200',
  amber: 'bg-amber-500/15 text-amber-300',
  violet: 'bg-violet-500/15 text-violet-300',
  sky: 'bg-sky-500/15 text-sky-300',
} as const

export function Chip({ children, tone = 'slate', title }: { children: ReactNode; tone?: keyof typeof CHIP_TONES; title?: string }) {
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 ${CHIP_TONES[tone]} ${title ? 'cursor-help' : ''}`}>
      {children}
    </span>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[10px] leading-snug text-slate-500">{children}</p>
}
