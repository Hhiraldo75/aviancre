import type { Sourced } from '../../types'

const STYLES = {
  public: { label: 'PUB', className: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  imported: { label: 'ACT', className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  estimated: { label: 'EST', className: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
} as const

/** Small pill showing where a value came from; hover for the source detail. */
export default function SourceBadge({ data }: { data: Pick<Sourced<unknown>, 'source' | 'sourceName' | 'confidence' | 'range' | 'notes'> }) {
  const style = STYLES[data.source]
  const detail = [
    data.sourceName,
    data.confidence && `Confidence: ${data.confidence}`,
    data.range && `Range: ${data.range.low.toFixed(2)} – ${data.range.high.toFixed(2)}`,
    data.notes,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span
      title={detail}
      className={`ml-1.5 inline-flex cursor-help items-center rounded px-1 py-px align-middle text-[9px] font-semibold tracking-wide ring-1 ring-inset ${style.className}`}
    >
      {style.label}
    </span>
  )
}
