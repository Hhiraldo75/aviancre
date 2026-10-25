import { useState } from 'react'
import type { ReactNode } from 'react'
import { fmt } from '../../lib/format'
import {
  activeFilterChips,
  EXPIRATION_YEARS,
  FILTER_ASSET_TYPES,
  OCCUPANCY_PRESETS,
  pctFromInput,
  pctToInput,
  sfFromInput,
  sfToInput,
  submarketOptions,
  toggleValue,
} from '../../lib/filters'
import { useAppStore, usePropertyView } from '../../store/useAppStore'

export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        on ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-600 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Text box for a numeric filter. Keeps what the user typed (so "12." survives)
 * and resyncs when the stored value changes elsewhere: a chip, Clear all, a preset.
 */
export function NumberField<T extends number | null>({
  value,
  onChange,
  parse,
  toText,
  placeholder,
  label,
}: {
  value: T
  onChange: (value: T) => void
  parse: (text: string) => T
  toText: (value: T) => string
  placeholder: string
  label: string
}) {
  const [text, setText] = useState(() => toText(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    if (parse(text) !== value) setText(toText(value))
  }
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const next = parse(e.target.value)
        if (next !== value) onChange(next)
      }}
      className="w-16 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs tabular-nums placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
    />
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">{children}</div>
    </div>
  )
}

/** Compact filter bar above the property list; filters live in the store and apply to the map too. */
export default function FilterBar() {
  const f = useAppStore((s) => s.filters)
  const properties = useAppStore((s) => s.properties)
  const setFilter = useAppStore((s) => s.setFilter)
  const removeFilter = useAppStore((s) => s.removeFilter)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const zoomToResults = useAppStore((s) => s.zoomToResults)
  const { matching } = usePropertyView()
  const [open, setOpen] = useState(false)

  const chips = activeFilterChips(f)
  const hidden = chips.filter((c) => !c.key.startsWith('type:')).length

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_ASSET_TYPES.map((t) => (
          <Toggle key={t} on={f.assetTypes.includes(t)} onClick={() => setFilter('assetTypes', toggleValue(f.assetTypes, t))}>
            {fmt.label(t)}
          </Toggle>
        ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ml-auto text-[11px] text-slate-400 hover:text-slate-100"
        >
          {open ? 'Fewer filters ▴' : `More filters${hidden ? ` (${hidden})` : ''} ▾`}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-700 pt-3">
          <Row label="Rentable SF">
            <NumberField label="Minimum SF" placeholder="Min" value={f.minSF} onChange={(v) => setFilter('minSF', v)} parse={sfFromInput} toText={sfToInput} />
            –
            <NumberField label="Maximum SF" placeholder="Max" value={f.maxSF} onChange={(v) => setFilter('maxSF', v)} parse={sfFromInput} toText={sfToInput} />
          </Row>

          <Row label="Occupancy">
            {OCCUPANCY_PRESETS.map((o) => {
              const on = f.minOccupancy === o.min && f.maxOccupancy === o.max
              return (
                <Toggle
                  key={o.label}
                  on={on}
                  onClick={() => {
                    setFilter('minOccupancy', on ? null : o.min)
                    setFilter('maxOccupancy', on ? null : o.max)
                  }}
                >
                  {o.label}
                </Toggle>
              )
            })}
            <span className="flex items-center gap-1">
              <NumberField label="Minimum occupancy %" placeholder="Min %" value={f.minOccupancy} onChange={(v) => setFilter('minOccupancy', v)} parse={pctFromInput} toText={pctToInput} />
              –
              <NumberField label="Maximum occupancy % (exclusive)" placeholder="Max %" value={f.maxOccupancy} onChange={(v) => setFilter('maxOccupancy', v)} parse={pctFromInput} toText={pctToInput} />
            </span>
          </Row>

          <Row label="Lease expiration">
            ≥
            <NumberField label="Minimum % of SF expiring" placeholder="%" value={f.expiring.minShare} onChange={(v) => setFilter('expiring', { ...f.expiring, minShare: v })} parse={pctFromInput} toText={pctToInput} />
            % of SF expiring within
            <select
              aria-label="Expiration window"
              value={f.expiring.years}
              onChange={(e) => {
                const years = EXPIRATION_YEARS.find((y) => String(y) === e.target.value)
                if (years) setFilter('expiring', { ...f.expiring, years })
              }}
              className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-slate-200"
            >
              {EXPIRATION_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y} yr{y === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Submarket">
            {submarketOptions(properties).map((s) => (
              <Toggle key={s} on={f.submarkets.includes(s)} onClick={() => setFilter('submarkets', toggleValue(f.submarkets, s))}>
                {fmt.label(s)}
              </Toggle>
            ))}
          </Row>

          <Row label="Underwriting (current assumptions)">
            Levered IRR ≥
            <NumberField label="Minimum levered IRR %" placeholder="%" value={f.minLeveredIRR} onChange={(v) => setFilter('minLeveredIRR', v)} parse={pctFromInput} toText={pctToInput} />
            %
            <label
              title="Max bid at the target levered IRR, as in the Investment view"
              className="flex w-full cursor-pointer items-center gap-1.5 text-slate-300"
            >
              <input
                type="checkbox"
                checked={f.maxBidBelowPrice}
                onChange={(e) => setFilter('maxBidBelowPrice', e.target.checked)}
                className="accent-blue-500"
              />
              Max bid below current price
            </label>
          </Row>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => removeFilter(c.key)}
              title="Remove filter"
              className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] text-blue-200 hover:bg-blue-500/25"
            >
              {c.label} ✕
            </button>
          ))}
          <button type="button" onClick={clearFilters} className="text-[11px] text-slate-400 underline hover:text-slate-100">
            Clear all
          </button>
          <button
            type="button"
            onClick={zoomToResults}
            disabled={matching.length === 0}
            title="Fit the map to the matching sample buildings"
            className="ml-auto text-[11px] text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:text-slate-600"
          >
            Zoom to results
          </button>
        </div>
      )}
    </div>
  )
}
