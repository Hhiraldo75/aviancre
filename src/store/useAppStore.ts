import { useMemo } from 'react'
import { create } from 'zustand'
import type { GisDetails, ISODate, LngLat, ParcelLookup, Persona, PickedParcel, Property, TaxRecord, UnderwritingTab } from '../types'
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
import { isImportedDeal } from '../lib/importedDeals'
import { todayISO } from '../lib/metrics'
import { isRentRollPreset, withPreset, type RentRollPreset } from '../lib/rentRollConvert'
import { DEFAULTS_SET, isSavedSet, type SavedAssumptionSet } from '../lib/underwriting/assumptionSets'
import type { AssumptionEdits } from '../lib/underwriting/edits'
import { shouldShowWelcome } from '../lib/welcome'
import { lookupParcelAt, parcelPointByPin } from '../services/providenceGis'
import { isOnPin, lookupTaxRecord, lookupTaxRecordByPin } from '../services/providenceOpenData'

/** The ArcGIS Online parcel/zoning/flood layers are optional enrichment; give up on them after this long. */
const GIS_TIMEOUT_MS = 10_000

/** Browser only: tests import the store in Node. */
const hasWindow = typeof window !== 'undefined'

/**
 * Imported deals live only in this browser's local storage: never in the URL,
 * never sent anywhere. Storage can be unavailable (private window, blocked
 * site data), so every access is guarded and the app works without it.
 */
export const IMPORTED_DEALS_KEY = 'aviancre.importedDeals.v1'

function loadImportedDeals(): Property[] {
  if (!hasWindow) return []
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(IMPORTED_DEALS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter(isImportedDeal) : []
  } catch {
    return []
  }
}

/** False when the browser wouldn't store them (the deals then last until reload). */
function saveImportedDeals(properties: Property[]): boolean {
  if (!hasWindow) return true
  try {
    window.localStorage.setItem(IMPORTED_DEALS_KEY, JSON.stringify(properties.filter((p) => p.importedFrom)))
    return true
  } catch {
    return false
  }
}

/** Saved assumption sets, by property id; browser only, like imported deals. */
export const ASSUMPTION_SETS_KEY = 'aviancre.assumptionSets.v1'

function loadAssumptionSets(): Record<string, SavedAssumptionSet[]> {
  if (!hasWindow) return {}
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(ASSUMPTION_SETS_KEY) ?? '{}')
    if (typeof stored !== 'object' || stored === null) return {}
    return Object.fromEntries(
      Object.entries(stored).flatMap(([id, sets]) => (Array.isArray(sets) ? [[id, sets.filter(isSavedSet)]] : [])),
    )
  } catch {
    return {}
  }
}

/** Confirmed rent roll layout mappings (no deal data, only column labels and codes); browser only. */
export const RENT_ROLL_PRESETS_KEY = 'aviancre.rentRollPresets.v1'

function loadRentRollPresets(): RentRollPreset[] {
  if (!hasWindow) return []
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RENT_ROLL_PRESETS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isRentRollPreset) : []
  } catch {
    return []
  }
}

/** Set once the welcome screen has been dismissed; browser only. v2: the full-page screen replaced the v1 overlay. */
export const WELCOME_SEEN_KEY = 'aviancre.welcomeSeen.v2'

function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markWelcomeSeen() {
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    // Storage blocked: the welcome screen shows again next visit.
  }
}

/** Filters and sort start from the URL, so a shared link opens the same view. */
const initialView = hasWindow ? filtersFromQuery(window.location.search) : { filters: EMPTY_FILTERS, sort: DEFAULT_SORT }

/**
 * Single source of truth shared by the map and the side panel.
 * Filters, the lease-expiration timeline and underwriting assumptions live
 * here, so every view updates together.
 */
interface AppState {
  /** Sample properties, then imported deals (`importedFrom` set). */
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
  /** The underwriting panel's section; set when it opens. */
  underwritingTab: UnderwritingTab
  /** The welcome screen: first visit only, and not when the link already sets filters. */
  welcomeOpen: boolean
  /** Analyst edits to the default underwriting assumptions, by property id; kept for the session. */
  assumptionEdits: Record<string, AssumptionEdits>
  /** Named assumption sets, by property id. Kept in local storage; an imported deal's sets go when the deal is removed. */
  assumptionSets: Record<string, SavedAssumptionSet[]>
  /** The set last applied or saved, by property id; absent = Defaults. The edits may since differ from it. */
  activeSets: Record<string, string>
  /** Saved rent roll layout mappings; a matching one converts the same layout automatically. Kept in local storage. */
  rentRollPresets: RentRollPreset[]
  /** Portfolio filters; the map and the list show the same matching set. Mirrored in the URL. */
  filters: PropertyFilters
  sort: SortKey
  /** Bumped by "Zoom to results"; the map fits to the matching buildings on each change. */
  zoomRequest: number
  /** Where the map should fly next (an address search pick); `request` changes on each pick. */
  mapFocus: { lng: number; lat: number; request: number } | null
  select: (id: string | null) => void
  /** `picked`: the parcel chosen in the address search, matched to the tax roll by its PIN. */
  lookupParcel: (lng: number, lat: number, picked?: PickedParcel) => Promise<void>
  /**
   * Flies to a city parcel picked in the address search and looks it up as a click there would,
   * except that the tax-roll record is matched by its plat and lot.
   * Rejects when the parcel's outline can't be fetched; resolves once the lookup has started.
   */
  goToParcel: (picked: PickedParcel) => Promise<void>
  clearSelection: () => void
  setAsOf: (date: ISODate) => void
  setPersona: (persona: Persona) => void
  /** Opens the panel on `tab` (Cash flow by default). */
  openUnderwriting: (tab?: UnderwritingTab) => void
  closeUnderwriting: () => void
  setUnderwritingTab: (tab: UnderwritingTab) => void
  openWelcome: () => void
  /** Closes the welcome screen and remembers that it was seen. */
  closeWelcome: () => void
  /** `value` in engine units (Pct as a decimal); callers validate it first. */
  setAssumption: (propertyId: string, key: string, value: number) => void
  resetAssumption: (propertyId: string, key: string) => void
  /** Clears every edit and makes Defaults the active set. */
  resetAssumptions: (propertyId: string) => void
  /** Saves a set (replacing one with the same name), applies its edits and makes it active. */
  saveAssumptionSet: (propertyId: string, set: SavedAssumptionSet) => void
  /** Applies a saved set's edits, or Defaults (no edits). */
  applyAssumptionSet: (propertyId: string, name: string) => void
  /** Deletes a saved set; the current edits stay as they are. Defaults can't be deleted. */
  deleteAssumptionSet: (propertyId: string, name: string) => void
  /** Saves a preset, replacing one for the same layout or with the same name. */
  saveRentRollPreset: (preset: RentRollPreset) => void
  deleteRentRollPreset: (name: string) => void
  setFilter: <K extends keyof PropertyFilters>(key: K, value: PropertyFilters[K]) => void
  /** Clears the filter behind an active-filter chip (see `activeFilterChips`). */
  removeFilter: (chipKey: string) => void
  clearFilters: () => void
  setSort: (sort: SortKey) => void
  zoomToResults: () => void
  /**
   * Adds an imported deal (replacing one with the same id) and selects it.
   * Returns false when it couldn't be saved in the browser.
   */
  importDeal: (property: Property) => boolean
  /** Removes an imported deal, its assumption edits and its selection. Sample properties can't be removed. */
  removeImportedDeal: (id: string) => void
}

/** In-flight parcel request; a newer click aborts the older one. */
let inFlight: AbortController | null = null

function cancelInFlight() {
  inFlight?.abort()
  inFlight = null
}

export const useAppStore = create<AppState>()((set, get) => ({
  properties: [...SAMPLE_PROPERTIES, ...loadImportedDeals()],
  selectedId: null,
  parcel: { status: 'idle' },
  asOf: todayISO(),
  activePersona: 'Analyst',
  underwritingOpen: false,
  underwritingTab: 'Cash flow',
  welcomeOpen: hasWindow && shouldShowWelcome(window.location.search, hasSeenWelcome()),
  assumptionEdits: {},
  assumptionSets: loadAssumptionSets(),
  activeSets: {},
  rentRollPresets: loadRentRollPresets(),
  filters: initialView.filters,
  sort: initialView.sort,
  zoomRequest: 0,
  mapFocus: null,

  select: (id) => {
    cancelInFlight()
    set({ selectedId: id, parcel: { status: 'idle' }, underwritingOpen: false })
  },

  /**
   * Two sources in parallel:
   * 1. Providence Open Data tax roll – reachable from anywhere; shown as soon as it arrives.
   *    By plat and lot for a searched parcel, else the record nearest the click.
   * 2. ArcGIS Online parcel, zoning and flood layers (city + RIGIS) – zoning, flood, building size,
   *    outline; merged in if they answer in time. Once the parcel's PIN is known, a nearest-record
   *    match is replaced by the record on that plat and lot.
   */
  lookupParcel: async (lng, lat, picked) => {
    cancelInFlight()
    const controller = new AbortController()
    inFlight = controller
    const current = () => inFlight === controller
    set({ selectedId: null, parcel: { status: 'loading', lng, lat, picked }, underwritingOpen: false })

    const gisController = new AbortController()
    controller.signal.addEventListener('abort', () => gisController.abort())
    const timer = setTimeout(() => gisController.abort(), GIS_TIMEOUT_MS)

    const gisPromise: Promise<GisDetails> = lookupParcelAt(lng, lat, gisController.signal)
      .then((r): GisDetails => (r.parcel ? { status: 'ok', parcel: r.parcel, overlays: r.overlays } : { status: 'none' }))
      .catch((err): GisDetails => ({
        status: 'unavailable',
        reason: gisController.signal.aborted ? `no answer within ${GIS_TIMEOUT_MS / 1000} s` : err instanceof Error ? err.message : 'GIS error',
      }))
      .finally(() => clearTimeout(timer))

    let record: TaxRecord | null = null
    let taxError: string | null = null
    try {
      if (picked) record = await lookupTaxRecordByPin(picked.pin, lng, lat, controller.signal)
      record ??= await lookupTaxRecord(lng, lat, controller.signal)
    } catch (err) {
      if (!current()) return
      taxError = err instanceof Error ? err.message : 'Lookup failed'
    }
    if (!current()) return

    // Show the tax-roll result right away; GIS fills in when (if) it answers.
    if (record) set({ parcel: { status: 'loaded', lng, lat, record, gis: { status: 'loading' }, picked } })

    const gis = await gisPromise
    if (!current()) return

    const pin = gis.status === 'ok' ? gis.parcel.pin : undefined
    if (record?.matchedBy === 'distance' && pin) {
      if (isOnPin(record, pin)) record = { ...record, matchedBy: 'plat-lot' }
      // A searched PIN was already tried above.
      else if (pin !== picked?.pin) {
        // Keep the nearest record if the roll has no such lot or doesn't answer.
        const onLot = await lookupTaxRecordByPin(pin, lng, lat, controller.signal).catch(() => null)
        if (!current()) return
        record = onLot ?? record
      }
    }
    inFlight = null

    if (record || gis.status === 'ok') {
      set({ parcel: { status: 'loaded', lng, lat, record, gis, picked } })
    } else if (taxError) {
      set({ parcel: { status: 'error', lng, lat, message: taxError, picked } })
    } else {
      set({ parcel: { status: 'not-found', lng, lat, picked } })
    }
  },

  goToParcel: async (picked) => {
    cancelInFlight()
    const controller = new AbortController()
    inFlight = controller
    let point: LngLat
    try {
      point = await parcelPointByPin(picked.pin, controller.signal)
    } catch (err) {
      // A newer click or pick aborted this one: nothing to report.
      if (inFlight !== controller) return
      inFlight = null
      throw err
    }
    if (inFlight !== controller) return
    const [lng, lat] = point
    set((s) => ({ mapFocus: { lng, lat, request: (s.mapFocus?.request ?? 0) + 1 } }))
    void get().lookupParcel(lng, lat, picked)
  },

  clearSelection: () => {
    cancelInFlight()
    set({ selectedId: null, parcel: { status: 'idle' }, underwritingOpen: false })
  },

  setAsOf: (date) => set({ asOf: date }),
  setPersona: (persona) => set({ activePersona: persona }),
  openUnderwriting: (tab = 'Cash flow') => set({ underwritingOpen: true, underwritingTab: tab }),
  closeUnderwriting: () => set({ underwritingOpen: false }),
  setUnderwritingTab: (tab) => set({ underwritingTab: tab }),
  openWelcome: () => set({ welcomeOpen: true }),
  closeWelcome: () => {
    if (hasWindow) markWelcomeSeen()
    set({ welcomeOpen: false })
  },

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
      const { [propertyId]: _active, ...activeSets } = s.activeSets
      return { assumptionEdits: rest, activeSets }
    }),
  saveAssumptionSet: (propertyId, saved) =>
    set((s) => {
      const others = (s.assumptionSets[propertyId] ?? []).filter((x) => x.name !== saved.name)
      const { [propertyId]: _removed, ...otherEdits } = s.assumptionEdits
      const edits = { ...saved.edits }
      return {
        assumptionSets: { ...s.assumptionSets, [propertyId]: [...others, { ...saved, edits: { ...saved.edits } }] },
        assumptionEdits: Object.keys(edits).length ? { ...otherEdits, [propertyId]: edits } : otherEdits,
        activeSets: { ...s.activeSets, [propertyId]: saved.name },
      }
    }),
  applyAssumptionSet: (propertyId, name) => {
    if (name === DEFAULTS_SET) return get().resetAssumptions(propertyId)
    const saved = get().assumptionSets[propertyId]?.find((x) => x.name === name)
    if (!saved) return
    set((s) => {
      const { [propertyId]: _removed, ...otherEdits } = s.assumptionEdits
      const edits = { ...saved.edits }
      return {
        assumptionEdits: Object.keys(edits).length ? { ...otherEdits, [propertyId]: edits } : otherEdits,
        activeSets: { ...s.activeSets, [propertyId]: name },
      }
    })
  },
  deleteAssumptionSet: (propertyId, name) =>
    set((s) => {
      const remaining = (s.assumptionSets[propertyId] ?? []).filter((x) => x.name !== name)
      const { [propertyId]: _sets, ...otherSets } = s.assumptionSets
      const { [propertyId]: _active, ...otherActive } = s.activeSets
      return {
        assumptionSets: remaining.length ? { ...otherSets, [propertyId]: remaining } : otherSets,
        activeSets: s.activeSets[propertyId] === name ? otherActive : s.activeSets,
      }
    }),
  saveRentRollPreset: (preset) => set((s) => ({ rentRollPresets: withPreset(s.rentRollPresets, preset) })),
  deleteRentRollPreset: (name) => set((s) => ({ rentRollPresets: s.rentRollPresets.filter((p) => p.name !== name) })),

  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  removeFilter: (chipKey) => set((s) => ({ filters: withoutFilter(s.filters, chipKey) })),
  clearFilters: () => set({ filters: EMPTY_FILTERS }),
  setSort: (sort) => set({ sort }),
  zoomToResults: () => set((s) => ({ zoomRequest: s.zoomRequest + 1 })),

  importDeal: (property) => {
    if (!property.importedFrom) throw new Error(`${property.id} is not an imported deal`)
    get().resetAssumptions(property.id)
    const properties = [...get().properties.filter((p) => p.id !== property.id), property]
    get().select(property.id)
    set({ properties })
    return saveImportedDeals(properties)
  },
  removeImportedDeal: (id) => {
    const target = get().properties.find((p) => p.id === id)
    if (!target?.importedFrom) return
    get().resetAssumptions(id)
    set((s) => {
      const { [id]: _sets, ...assumptionSets } = s.assumptionSets
      return { assumptionSets }
    })
    if (get().selectedId === id) get().clearSelection()
    const properties = get().properties.filter((p) => p.id !== id)
    set({ properties })
    saveImportedDeals(properties)
  },
}))

// Persist saved assumption sets whenever they change.
if (hasWindow) {
  useAppStore.subscribe((s, prev) => {
    if (s.assumptionSets === prev.assumptionSets) return
    try {
      window.localStorage.setItem(ASSUMPTION_SETS_KEY, JSON.stringify(s.assumptionSets))
    } catch {
      // Storage blocked or full: the sets last until reload.
    }
  })
}

// Persist rent roll presets whenever they change.
if (hasWindow) {
  useAppStore.subscribe((s, prev) => {
    if (s.rentRollPresets === prev.rentRollPresets) return
    try {
      window.localStorage.setItem(RENT_ROLL_PRESETS_KEY, JSON.stringify(s.rentRollPresets))
    } catch {
      // Storage blocked or full: the presets last until reload.
    }
  })
}

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

const NO_SETS: SavedAssumptionSet[] = []

/** A property's saved assumption sets; a stable empty array when there are none. */
export const useAssumptionSets = (propertyId: string) => useAppStore((s) => s.assumptionSets[propertyId] ?? NO_SETS)

/** The set last applied or saved for a property (Defaults when none). */
export const useActiveSetName = (propertyId: string) => useAppStore((s) => s.activeSets[propertyId] ?? DEFAULTS_SET)
