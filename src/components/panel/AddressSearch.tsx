import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { matchLocalProperties, parseAddressQuery, type ParcelSuggestion } from '../../lib/addressSearch'
import { searchParcelAddresses } from '../../services/providenceGis'
import { useAppStore } from '../../store/useAppStore'
import type { Property } from '../../types'
import { Chip } from '../ui/Card'
import ImportedChip from '../ui/ImportedChip'

const DEBOUNCE_MS = 250
const SEARCH_TIMEOUT_MS = 8_000
const MAX_SUGGESTIONS = 8
const MAX_LOCAL = 3

type Option = { kind: 'property'; property: Property } | { kind: 'parcel'; parcel: ParcelSuggestion }

/** City parcel results for one search text; `failed` when the service didn't answer. */
interface Results {
  text: string
  parcels: ParcelSuggestion[]
  failed: boolean
}

/** Our own properties first (matched in the browser), then city parcels, up to 8 in all. */
function optionsFor(properties: Property[], text: string, parcels: ParcelSuggestion[]): Option[] {
  const local = matchLocalProperties(properties, text, MAX_LOCAL)
  return [
    ...local.map((property): Option => ({ kind: 'property', property })),
    ...parcels.slice(0, MAX_SUGGESTIONS - local.length).map((parcel): Option => ({ kind: 'parcel', parcel })),
  ]
}

/**
 * Address search over the city's parcel layer plus the sample properties and
 * imported deals. Picking a parcel flies there and opens its public record,
 * the same as clicking it on the map; picking one of ours selects it.
 */
export default function AddressSearch() {
  const properties = useAppStore((s) => s.properties)
  const select = useAppStore((s) => s.select)
  const goToParcel = useAppStore((s) => s.goToParcel)

  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results | null>(null)
  const [loading, setLoading] = useState(false)
  /** Row highlighted with the arrow keys; -1 = none (Enter takes the top one). */
  const [active, setActive] = useState(-1)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const timerRef = useRef<number | undefined>(undefined)
  const requestRef = useRef<AbortController | null>(null)
  /** Enter was pressed before the results came in: pick the top one when they do. */
  const pickOnArrivalRef = useRef(false)
  const listId = useId()

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      requestRef.current?.abort()
    },
    [],
  )

  const query = parseAddressQuery(text)
  const current = results?.text === text && !loading
  const options = query ? optionsFor(properties, text, results?.parcels ?? []) : []

  const pick = async (option: Option) => {
    setOpen(false)
    setActive(-1)
    setPickError(null)
    pickOnArrivalRef.current = false
    if (option.kind === 'property') {
      // Clear the box rather than show the name: a search for it would send an imported deal's name to the city.
      cancelSearch()
      setText('')
      setResults(null)
      select(option.property.id)
      return
    }
    setText(option.parcel.address)
    setPicking(true)
    try {
      await goToParcel({ pin: option.parcel.pin, address: option.parcel.address })
    } catch (err) {
      setPickError(`Couldn't load that parcel: ${err instanceof Error ? err.message : 'lookup failed'}`)
    } finally {
      setPicking(false)
    }
  }

  const cancelSearch = () => {
    window.clearTimeout(timerRef.current)
    requestRef.current?.abort()
    requestRef.current = null
    setLoading(false)
  }

  const runSearch = (value: string) => {
    cancelSearch()
    if (!parseAddressQuery(value)) {
      setResults(null)
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    setLoading(true)
    searchParcelAddresses(value, controller.signal, MAX_SUGGESTIONS)
      .then((parcels): Results => ({ text: value, parcels, failed: false }))
      .catch((): Results => ({ text: value, parcels: [], failed: true }))
      .then((r) => {
        window.clearTimeout(timer)
        // A newer search replaced this one.
        if (requestRef.current !== controller) return
        requestRef.current = null
        setResults(r)
        setLoading(false)
        setActive(-1)
        if (pickOnArrivalRef.current) {
          pickOnArrivalRef.current = false
          const top = optionsFor(useAppStore.getState().properties, value, r.parcels)[0]
          if (top) void pick(top)
        }
      })
  }

  const onChange = (value: string) => {
    setText(value)
    setOpen(true)
    setActive(-1)
    setPickError(null)
    pickOnArrivalRef.current = false
    cancelSearch()
    if (!parseAddressQuery(value)) {
      setResults(null)
      return
    }
    timerRef.current = window.setTimeout(() => runSearch(value), DEBOUNCE_MS)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return
      e.preventDefault()
      setOpen(true)
      // Cycles through the rows and back to none (-1).
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        const next = i + step
        return next >= options.length ? -1 : next < -1 ? options.length - 1 : next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!query) return
      const highlighted = open && active >= 0 ? options[active] : undefined
      // Our own properties always come first, so the top row is final once they match.
      const top = highlighted ?? (current || options[0]?.kind === 'property' ? options[0] : undefined)
      if (top) return void pick(top)
      if (current) return
      // Results not in yet: search now and take the top one when it answers.
      setOpen(true)
      pickOnArrivalRef.current = true
      if (!(loading && requestRef.current)) runSearch(text)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (open && query) setOpen(false)
      else onChange('')
    }
  }

  const showList = open && query !== null && (options.length > 0 || loading || current)
  const rowId = (i: number) => `${listId}-option-${i}`

  return (
    <div className="relative mb-4">
      <input
        type="search"
        role="combobox"
        aria-label="Search an address in Providence"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? rowId(active) : undefined}
        placeholder="Search an address in Providence"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setOpen(true)
          if (query && results?.text !== text && !loading) runSearch(text)
        }}
        onBlur={() => setOpen(false)}
        className="w-full rounded border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
      />
      {picking && <p className="mt-1 text-[11px] text-slate-400">Opening parcel…</p>}
      {pickError && <p className="mt-1 text-[11px] text-red-300">{pickError}</p>}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded border border-slate-600 bg-slate-900 py-1 text-xs shadow-xl"
        >
          {options.map((o, i) => (
            <li
              key={o.kind === 'property' ? `p-${o.property.id}` : `c-${o.parcel.pin}`}
              id={rowId(i)}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the blur doesn't close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pick(o)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 ${i === active ? 'bg-slate-700' : ''}`}
            >
              {o.kind === 'property' ? (
                <>
                  <span className="min-w-0">
                    <span className="block truncate text-slate-100">{o.property.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{o.property.location.address}</span>
                  </span>
                  <span className="shrink-0 text-[10px]">
                    {o.property.importedFrom ? <ImportedChip from={o.property.importedFrom} /> : <Chip tone="sky">Sample</Chip>}
                  </span>
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate text-slate-100">{o.parcel.address}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {o.parcel.units > 1 ? `${o.parcel.units} units · ` : ''}Parcel
                  </span>
                </>
              )}
            </li>
          ))}
          {loading && <li className="px-2.5 py-1.5 text-slate-400">Searching city parcels…</li>}
          {current && results?.failed && (
            <li className="px-2.5 py-1.5 text-amber-300">
              City parcel search is unavailable right now. You can still click a building on the map.
            </li>
          )}
          {current && !results?.failed && options.length === 0 && (
            <li className="px-2.5 py-1.5 text-slate-400">No matches in Providence</li>
          )}
        </ul>
      )}
    </div>
  )
}
