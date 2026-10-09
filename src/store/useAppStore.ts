import { useMemo } from 'react'
import { create } from 'zustand'
import type { GisDetails, ISODate, ParcelLookup, Persona, Property, TaxRecord } from '../types'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  propertyView,
  underwritingFactsById,
  underwritingNeeds,
  withoutFilter,
  type PropertyFilters,
  type PropertyView,
  type SortKey,
} from '../lib/filters'
import { todayISO } from '../lib/metrics'
import type { AssumptionEdits } from '../lib/underwriting/edits'
import { lookupParcelAt } from '../services/providenceGis'
import { lookupTaxRecord } from '../services/providenceOpenData'

/** The city GIS server is optional enrichment; give up on it after this long. */
const GIS_TIMEOUT_MS = 8000

/** Browser only: tests import the store in Node. */
const hasWindow = typeof window !== 'undefined'

/** Filters and sort start from the URL, so a shared link opens the same view. */
const initialView = hasWindow ? filtersFromQuery(window.location.search) : { filters: EMPTY_FILTERS, sort: DEFAULT_SORT }

/**
 * Single source of truth shared by the map and the side panel.
 * Filters, the lease-expiration timeline and underwriting assumptions live
 * here, so every view updates together.
 */
interface AppState {
  properties: Property[]
  /** Selected sample property (mutually exclusive with a parcel lookup). */
  selectedId: string | null
  /** Public-record lookup for a clicked point on the map. */
  parcel: ParcelLookup
  /** Analysis date for occupancy and rent calculations. */
  asOf: ISODate
  /** Which professional lens the sidebar shows. */
  activePersona: Persona
  /** Whether the full underwriting panel is open over the map (selected property only). */
  underwritingOpen: boolean
  /** Analyst edits to the default underwriting assumptions, by property id; kept for the session. */
  assumptionEdits: Record<string, AssumptionEdits>
  /** Portfolio filters; the map and the list show the same matching set. Mirrored in the URL. */
  filters: PropertyFilters
  sort: SortKey
  select: (id: string | null) => void
  lookupParcel: (lng: number, lat: number) => Promise<void>
  clearSelection: () => void
  setAsOf: (date: ISODate) => void
  setPersona: (persona: Persona) => void
  openUnderwriting: () => void
  closeUnderwriting: () => void
  /** `value` in engine units (Pct as a decimal); callers validate it first. */
  setAssumption: (propertyId: string, key: string, value: number) => void
  resetAssumption: (propertyId: string, key: string) => void
  resetAssumptions: (propertyId: string) => void
  setFilter: <K extends keyof PropertyFilters>(key: K, value: PropertyFilters[K]) => void
  /** Clears the filter behind an active-filter chip (see `activeFilterChips`). */
  removeFilter: (chipKey: string) => void
  clearFilters: () => void
  setSort: (sort: SortKey) => void
}

/** In-flight parcel request; a newer click aborts the older one. */
let inFlight: AbortController | null = null

function cancelInFlight() {
  inFlight?.abort()
  inFlight = null
}

export const useAppStore = create<AppState>()((set) => ({
  properties: SAMPLE_PROPERTIES,
  selectedId: null,
  parcel: { status: 'idle' },
  asOf: todayISO(),
  activePersona: 'Analyst',
  underwritingOpen: false,
  assumptionEdits: {},
  filters: initialView.filters,
  sort: initialView.sort,

  select: (id) => {
    cancelInFlight()
    set({ selectedId: id, parcel: { status: 'idle' }, underwritingOpen: false })
  },

  /**
   * Two sources in parallel:
   * 1. Providence Open Data tax roll – reachable from anywhere; shown as soon as it arrives.
   * 2. City GIS server – zoning, flood, building size, outline; merged in if it answers in time.
   */
  lookupParcel: async (lng, lat) => {
    cancelInFlight()
    const controller = new AbortController()
    inFlight = controller
    const current = () => inFlight === controller
    set({ selectedId: null, parcel: { status: 'loading', lng, lat }, underwritingOpen: false })

    const gisController = new AbortController()
    controller.signal.addEventListener('abort', () => gisController.abort())
    const timer = setTimeout(() => gisController.abort(), GIS_TIMEOUT_MS)

    const gisPromise: Promise<GisDetails> = lookupParcelAt(lng, lat, gisController.signal)
      .then((r): GisDetails => (r.parcel ? { status: 'ok', parcel: r.parcel, overlays: r.overlays } : { status: 'none' }))
      .catch((err): GisDetails => ({
        status: 'unavailable',
        reason: gisController.signal.aborted ? 'City GIS server did not respond' : err instanceof Error ? err.message : 'City GIS error',
      }))
      .finally(() => clearTimeout(timer))

    let record: TaxRecord | null = null
    let taxError: string | null = null
    try {
      record = await lookupTaxRecord(lng, lat, controller.signal)
    } catch (err) {
      if (!current()) return
      taxError = err instanceof Error ? err.message : 'Lookup failed'
    }
    if (!current()) return

    // Show the tax-roll result right away; GIS fills in when (if) it answers.
    if (record) set({ parcel: { status: 'loaded', lng, lat, record, gis: { status: 'loading' } } })

    const gis = await gisPromise
    if (!current()) return
    inFlight = null

    if (record || gis.status === 'ok') {
      set({ parcel: { status: 'loaded', lng, lat, record, gis } })
    } else if (taxError) {
      set({ parcel: { status: 'error', lng, lat, message: taxError } })
    } else {
      set({ parcel: { status: 'not-found', lng, lat } })
    }
  },

  clearSelection: () => {
    cancelInFlight()
    set({ selectedId: null, parcel: { status: 'idle' }, underwritingOpen: false })
  },

  setAsOf: (date) => set({ asOf: date }),
  setPersona: (persona) => set({ activePersona: persona }),
  openUnderwriting: () => set({ underwritingOpen: true }),
  closeUnderwriting: () => set({ underwritingOpen: false }),

  setAssumption: (propertyId, key, value) =>
    set((s) => ({
      assumptionEdits: { ...s.assumptionEdits, [propertyId]: { ...s.assumptionEdits[propertyId], [key]: value } },
    })),
  resetAssumption: (propertyId, key) =>
    set((s) => {
      const current = s.assumptionEdits[propertyId]
      if (!current || !(key in current)) return {}
      const { [key]: _removed, ...rest } = current
      return { assumptionEdits: { ...s.assumptionEdits, [propertyId]: rest } }
    }),
  resetAssumptions: (propertyId) =>
    set((s) => {
      const { [propertyId]: _removed, ...rest } = s.assumptionEdits
      return { assumptionEdits: rest }
    }),

  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  removeFilter: (chipKey) => set((s) => ({ filters: withoutFilter(s.filters, chipKey) })),
  clearFilters: () => set({ filters: EMPTY_FILTERS }),
  setSort: (sort) => set({ sort }),
}))

// Keep the URL in step with the filters (replacing, not adding, history entries).
if (hasWindow) {
  useAppStore.subscribe((s, prev) => {
    if (s.filters === prev.filters && s.sort === prev.sort) return
    const q = filtersToQuery(s.filters, s.sort)
    const { pathname, hash } = window.location
    window.history.replaceState(window.history.state, '', `${pathname}${q ? `?${q}` : ''}${hash}`)
  })
}

const NO_EDITS: AssumptionEdits = {}

/** The analyst's assumption edits for a property; a stable empty object when there are none. */
export const useAssumptionEdits = (propertyId: string) => useAppStore((s) => s.assumptionEdits[propertyId] ?? NO_EDITS)

export const useSelectedProperty = () =>
  useAppStore((s) => s.properties.find((p) => p.id === s.selectedId) ?? null)

/**
 * The filtered, sorted properties shared by the map, the list and the detail
 * header. Engine figures come from the memoized underwriting runs at each
 * property's current assumptions, and only when a filter or the sort uses them.
 */
export function usePropertyView(): PropertyView {
  const properties = useAppStore((s) => s.properties)
  const filters = useAppStore((s) => s.filters)
  const sort = useAppStore((s) => s.sort)
  const asOf = useAppStore((s) => s.asOf)
  const edits = useAppStore((s) => s.assumptionEdits)
  return useMemo(() => {
    const facts = underwritingFactsById(properties, asOf, edits, underwritingNeeds(filters, sort))
    return propertyView(properties, filters, sort, asOf, facts)
  }, [properties, filters, sort, asOf, edits])
}
