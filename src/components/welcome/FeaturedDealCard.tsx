import { useMemo } from 'react'
import { FEATURED_PROPERTY_ID, featuredDeal } from '../../lib/welcome'
import { useAppStore, useAssumptionEdits } from '../../store/useAppStore'

/** The selected tower's card: Westminster Office Tower's headline figures from the underwriting engine. */
export default function FeaturedDealCard() {
  const property = useAppStore((s) => s.properties.find((p) => p.id === FEATURED_PROPERTY_ID))
  const asOf = useAppStore((s) => s.asOf)
  const edits = useAssumptionEdits(FEATURED_PROPERTY_ID)
  const deal = useMemo(() => (property ? featuredDeal(property, asOf, edits) : null), [property, asOf, edits])
  if (!deal) return null

  return (
    <div className="absolute left-0 top-[2%] box-border flex w-[min(240px,40%)] flex-col gap-[9px] rounded-[10px] border border-av-callout-line bg-av-card px-4 py-3.5 shadow-[0_20px_40px_#00000080] max-[560px]:hidden">
      <div className="flex justify-between gap-2 font-plex text-[11px] uppercase tracking-[0.08em]">
        <span className="text-av-accent">Selected</span>
        <span className="text-av-amber">Sample</span>
      </div>
      <span className="text-[17px] font-bold leading-[1.2]">{deal.name}</span>
      {deal.status === 'ok' ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-av-muted">
          {deal.stats.map((s) => (
            <span key={s.label} className="flex flex-col" title={s.hint}>
              {s.label}
              <span className="whitespace-nowrap font-plex text-sm text-av-ink">{s.value}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs leading-snug text-av-muted">{deal.reason}</p>
      )}
    </div>
  )
}
