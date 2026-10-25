import { useMemo } from 'react'
import { create } from 'zustand'
import type { MultiPolygon, Polygon } from 'geojson'
import type {
  DealPlacement,
  GisDetails,
  ISODate,
  LngLat,
  ParcelLookup,
  Persona,
  PickedParcel,
  Property,
  T12Statement,
  TaxRecord,
  Scenario,
  UnderwritingTab,
} from '../types'
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
import { exactAddressMatch, type ParcelSuggestion } from '../lib/addressSearch'
import { platLotToPin } from '../lib/citywide/join'
import type { CitywideOutlines, CitywideSnapshot } from '../lib/citywide/types'
import {
  DEFAULT_CITYWIDE_SORT,
  EMPTY_CITYWIDE_FILTERS,
  screeningRows,
  type CitywideFilters,
  type CitywideSort,
  type ScreeningRow,
} from '../lib/citywide/view'
import { interiorPoint, parcelOutline, type BuildingOutline } from '../lib/geo'
import {
  carryPlacement,
  isImportedDeal,
  OSM_TILES_SOURCE,
  parcelFacts,
  withoutPlacement,
  withPlacement,
  withValidPlacement,
  type ParcelFacts,
} from '../lib/importedDeals'
import { todayISO } from '../lib/metrics'
import { isRentRollPreset, withPreset, type RentRollPreset } from '../lib/rentRollConvert'
import { isT12Statement, withoutT12, withT12 } from '../lib/t12'
import {
  DEFAULTS_SET,
  expenseLineLabels,
  isSavedSet,
  reconcileExpenseEdits,
  recordedExpenseLines,
  type SavedAssumptionSet,
} from '../lib/underwriting/assumptionSets'
import { defaultsFor, SCENARIO_KEY_PREFIX, type AssumptionEdits } from '../lib/underwriting/edits'
import { shouldShowWelcome } from '../lib/welcome'
import { fromPublic } from '../lib/sourced'
import { loadCitywideOutlines, loadCitywideSnapshot } from '../services/citywideSnapshot'
import { lookupParcelAt, parcelPointByPin, PVD_SOURCE, searchParcelAddresses } from '../services/providenceGis'
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
    return Array.isArray(list) ? list.filter(isImportedDeal).map(withValidPlacement) : []
  } catch {
    return []
  }
}

/** False when the browser wouldn't store them (the deals then last until reload). */
function saveImportedDeals(properties: Property[]): boolean {
  if (!hasWindow) return true
  try {
    // A loaded T-12 is kept in its own entry, never inside the deal.
    window.localStorage.setItem(IMPORTED_DEALS_KEY, JSON.stringify(properties.filter((p) => p.importedFrom).map(withoutT12)))
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

/**
 * Loaded T-12s, by property id; browser only, like imported deals, and never
 * sent anywhere. Attached to their property at run time.
 */
export const T12_KEY = 'aviancre.t12.v1'

function loadT12s(): Record<string, T12Statement> {
  if (!hasWindow) return {}
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(T12_KEY) ?? '{}')
    if (typeof stored !== 'object' || stored === null) return {}
    return Object.fromEntries(Object.entries(stored).filter(([, x]) => isT12Statement(x)))
  } catch {
    return {}
  }
}

/** False when the browser wouldn't store them (they then last until reload). */
function saveT12s(t12s: Record<string, T12Statement>): boolean {
  if (!hasWindow) return true
  try {
    window.localStorage.setItem(T12_KEY, JSON.stringify(t12s))
    return true
  } catch {
    return false
  }
}

const attachT12s = (properties: Property[], t12s: Record<string, T12Statement>) =>
  properties.map((p) => (t12s[p.id] ? withT12(withoutT12(p), t12s[p.id]) : withoutT12(p)))

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

/** "Place on map" for an imported deal: waiting for a pick, finding the parcel, or failed. */
export type PlacingState =
  | { dealId: string; status: 'choosing' }
  | { dealId: string; status: 'locating' }
  | { dealId: string; status: 'failed'; message: string }

/** A parcel found for a deal; the map reads the OSM building on it from its tiles, then calls `completePlacement`. */
export interface PlacementRequest {
  dealId: string
  pin: string
  cityAddress: string
  method: DealPlacement['method']
  /** Inside the parcel: the deal's new map point. */
  point: LngLat
  parcel: Polygon | MultiPolygon
  /** The parcel's zoning, lot and building area, copied into the deal. */
  facts: ParcelFacts
}

/** Filters and sort start from the URL, so a shared link opens the same view. */
/** The citywide screening layer: nothing is fetched until it is first turned on. */
export type CitywideState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      meta: CitywideSnapshot['meta']
      rows: ScreeningRow[]
      byPin: Map<string, ScreeningRow>
      /** Fetched on the first zoom in far enough to draw them. */
      outlines: 'not-loaded' | 'loading' | 'failed' | CitywideOutlines
    }

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
  /** The public record of the parcel the selected imported deal is placed on. */
  dealRecord: { id: string; lookup: ParcelLookup } | null
  placing: PlacingState | null
  placementRequest: PlacementRequest | null
  /** Analysis date for occupancy and rent calculations. */
  asOf: ISODate
  /** Which professional lens the sidebar shows. */
  activePersona: Persona
  /** Whether the full underwriting panel is open over the map (selected property only). */
  underwritingOpen: boolean
  /** The underwriting panel's section; set when it opens. */
  underwritingTab: UnderwritingTab
  /** The case the underwriting panel shows; set when it opens (Base by default). */
  underwritingScenario: Scenario
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
  /** Loaded T-12s, by property id; attached to the properties above. Kept in local storage. */
  t12s: Record<string, T12Statement>
  /** Why expense edits were just dropped (a T-12 loaded or removed, or a set made on other lines), by property id. */
  assumptionNotices: Record<string, string>
  /** Portfolio filters; the map and the list show the same matching set. Mirrored in the URL. */
  filters: PropertyFilters
  sort: SortKey
  /** Bumped by "Zoom to results"; the map fits to the matching buildings on each change. */
  zoomRequest: number
  /** Where the map should fly next (an address search pick); `request` changes on each pick. */
  mapFocus: { lng: number; lat: number; request: number } | null
  citywide: CitywideState
  /** The "Citywide estimates" map layer. */
  citywideVisible: boolean
  /** The screening list panel over the map. */
  citywideListOpen: boolean
  /** Screening list filters; parcels outside them are drawn faint on the map. */
  citywideFilters: CitywideFilters
  citywideSort: CitywideSort
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
  /** Opens the panel on `tab` (Cash flow by default) showing `scenario` (Base by default). */
  openUnderwriting: (tab?: UnderwritingTab, scenario?: Scenario) => void
  closeUnderwriting: () => void
  setUnderwritingTab: (tab: UnderwritingTab) => void
  setUnderwritingScenario: (scenario: Scenario) => void
  openWelcome: () => void
  /** Closes the welcome screen and remembers that it was seen. */
  closeWelcome: () => void
  /** `value` in engine units (Pct as a decimal); callers validate it first. */
  setAssumption: (propertyId: string, key: string, value: number) => void
  resetAssumption: (propertyId: string, key: string) => void
  /** Clears every edit and makes Defaults the active set. */
  resetAssumptions: (propertyId: string) => void
  /** Clears the edited Downside/Upside presets only; Base edits stay. */
  resetScenarioPresets: (propertyId: string) => void
  /** Saves a set (replacing one with the same name), applies its edits and makes it active. */
  saveAssumptionSet: (propertyId: string, set: SavedAssumptionSet) => void
  /** Applies a saved set's edits, or Defaults (no edits). */
  applyAssumptionSet: (propertyId: string, name: string) => void
  /** Deletes a saved set; the current edits stay as they are. Defaults can't be deleted. */
  deleteAssumptionSet: (propertyId: string, name: string) => void
  /** Saves a preset, replacing one for the same layout or with the same name. */
  saveRentRollPreset: (preset: RentRollPreset) => void
  deleteRentRollPreset: (name: string) => void
  /**
   * Loads a T-12 for a property (replacing any earlier one): Year-1 expenses and
   * other income then come from it. Expense edits made on the old lines are
   * dropped, with a notice. Returns false when it couldn't be saved in the browser.
   */
  loadT12: (propertyId: string, statement: T12Statement) => boolean
  /** Back to benchmark expenses and the rent roll's other income. */
  removeT12: (propertyId: string) => void
  dismissAssumptionNotice: (propertyId: string) => void
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
  /** Looks up the public record of the parcel a deal is placed on (by its plat and lot). */
  loadDealRecord: (id: string) => Promise<void>
  /** "Place on map": the next search pick or map click places the deal. */
  startPlacing: (id: string) => void
  cancelPlacing: () => void
  /**
   * Searches the city parcels for the deal's rent roll address (only the address is sent).
   * Places the deal when exactly one parcel has that address; otherwise returns the closest parcels to pick from.
   */
  findDealByAddress: (id: string) => Promise<{ placed: boolean; candidates: ParcelSuggestion[] }>
  /** Finds the city parcel for a searched PIN or a clicked point and asks the map for its building. */
  placeDeal: (id: string, target: PickedParcel | { lng: number; lat: number }, method: DealPlacement['method']) => Promise<void>
  /**
   * Puts the deal on the parcel, on the OSM building found there or else the parcel outline, saves it and selects it.
   * Returns false when it couldn't be saved in the browser; ignored when a newer request replaced this one.
   */
  completePlacement: (request: PlacementRequest, outline: BuildingOutline | null) => boolean
  /** Back to the approximate pin at the submarket's center. */
  resetDealLocation: (id: string) => boolean
  /** Shows or hides the citywide layer; the first time on (or after a failed load), loads the snapshot. */
  toggleCitywide: () => void
  /** Fetches the parcel outlines once; the map asks when zoomed in. */
  loadCitywideOutlines: () => void
  setCitywideListOpen: (open: boolean) => void
  setCitywideFilter: <K extends keyof CitywideFilters>(key: K, value: CitywideFilters[K]) => void
  clearCitywideFilters: () => void
  setCitywideSort: (sort: CitywideSort) => void
  /** Looks up a snapshot parcel's public record by its PIN, at its point; `fly` also moves the map there. */
  openCitywideParcel: (pin: string, fly: boolean) => void
}

/** In-flight parcel request; a newer click aborts the older one. */
let inFlight: AbortController | null = null

function cancelInFlight() {
  inFlight?.abort()
  inFlight = null
}

/** In-flight public-record request for the selected placed deal. */
let dealRecordInFlight: AbortController | null = null

function cancelDealRecord() {
  dealRecordInFlight?.abort()
  dealRecordInFlight = null
}

/**
 * Two sources in parallel:
 * 1. Providence Open Data tax roll – reachable from anywhere; passed to `early` as soon as it arrives.
 *    By plat and lot for a searched parcel, else the record nearest the click.
 * 2. ArcGIS Online parcel, zoning and flood layers (city + RIGIS) – zoning, flood, building size,
 *    outline; merged in if they answer in time. Once the parcel's PIN is known, a nearest-record
 *    match is replaced by the record on that plat and lot.
 * Resolves to the final lookup, or null once `current()` is false (a newer request replaced it).
 */
async function runLookup(
  lng: number,
  lat: number,
  picked: PickedParcel | undefined,
  signal: AbortSignal,
  current: () => boolean,
  early: (lookup: ParcelLookup) => void,
): Promise<ParcelLookup | null> {
  const gisController = new AbortController()
  signal.addEventListener('abort', () => gisController.abort())
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
    if (picked) record = await lookupTaxRecordByPin(picked.pin, lng, lat, signal)
    record ??= await lookupTaxRecord(lng, lat, signal)
  } catch (err) {
    if (!current()) return null
    taxError = err instanceof Error ? err.message : 'Lookup failed'
  }
  if (!current()) return null

  // Show the tax-roll result right away; GIS fills in when (if) it answers.
  if (record) early({ status: 'loaded', lng, lat, record, gis: { status: 'loading' }, picked })

  const gis = await gisPromise
  if (!current()) return null

  const pin = gis.status === 'ok' ? gis.parcel.pin : undefined
  if (record?.matchedBy === 'distance' && pin) {
    if (isOnPin(record, pin)) record = { ...record, matchedBy: 'plat-lot' }
    // A searched PIN was already tried above.
    else if (pin !== picked?.pin) {
      // Keep the nearest record if the roll has no such lot or doesn't answer.
      const onLot = await lookupTaxRecordByPin(pin, lng, lat, signal).catch(() => null)
      if (!current()) return null
      record = onLot ?? record
    }
  }

  if (record || gis.status === 'ok') return { status: 'loaded', lng, lat, record, gis, picked }
  if (taxError) return { status: 'error', lng, lat, message: taxError, picked }
  return { status: 'not-found', lng, lat, picked }
}

const initialT12s = loadT12s()

/** Replaces the property's T-12 (or removes it) and drops expense edits made on the old lines. */
function swapT12(s: AppState, propertyId: string, statement: T12Statement | null): Partial<AppState> {
  const old = s.properties.find((p) => p.id === propertyId)
  if (!old) return {}
  const t12s = { ...s.t12s }
  if (statement) t12s[propertyId] = statement
  else delete t12s[propertyId]
  const base = withoutT12(old)
  const next = statement ? withT12(base, statement) : base
  const properties = s.properties.map((p) => (p.id === propertyId ? next : p))
  const edits = s.assumptionEdits[propertyId]
  if (!edits) return { t12s, properties }
  const r = reconcileExpenseEdits(next, s.asOf, edits, expenseLineLabels(defaultsFor(old, s.asOf)))
  if (!r.notice) return { t12s, properties }
  return {
    t12s,
    properties,
    assumptionEdits: { ...s.assumptionEdits, [propertyId]: r.edits },
    assumptionNotices: { ...s.assumptionNotices, [propertyId]: r.notice },
  }
}

export const useAppStore = create<AppState>()((set, get) => ({
  properties: attachT12s([...SAMPLE_PROPERTIES, ...loadImportedDeals()], initialT12s),
  selectedId: null,
  parcel: { status: 'idle' },
  dealRecord: null,
  placing: null,
  placementRequest: null,
  asOf: todayISO(),
  activePersona: 'Analyst',
  underwritingOpen: false,
  underwritingTab: 'Cash flow',
  underwritingScenario: 'base',
  welcomeOpen: hasWindow && shouldShowWelcome(window.location.search, hasSeenWelcome()),
  assumptionEdits: {},
  assumptionSets: loadAssumptionSets(),
  activeSets: {},
  rentRollPresets: loadRentRollPresets(),
  t12s: initialT12s,
  assumptionNotices: {},
  filters: initialView.filters,
  sort: initialView.sort,
  zoomRequest: 0,
  mapFocus: null,
  citywide: { status: 'off' },
  citywideVisible: false,
  citywideListOpen: false,
  citywideFilters: EMPTY_CITYWIDE_FILTERS,
  citywideSort: DEFAULT_CITYWIDE_SORT,

  select: (id) => {
    cancelInFlight()
    // Selecting the same deal again keeps its public record.
    const keep = id !== null && get().dealRecord?.id === id
    if (!keep) cancelDealRecord()
    set((s) => ({
      selectedId: id,
      parcel: { status: 'idle' },
      dealRecord: keep ? s.dealRecord : null,
      placing: null,
      placementRequest: null,
      underwritingOpen: false,
    }))
  },

  /** See `runLookup`. */
  lookupParcel: async (lng, lat, picked) => {
    cancelInFlight()
    cancelDealRecord()
    const controller = new AbortController()
    inFlight = controller
    const current = () => inFlight === controller
    set({
      selectedId: null,
      parcel: { status: 'loading', lng, lat, picked },
      dealRecord: null,
      placing: null,
      placementRequest: null,
      underwritingOpen: false,
    })

    const result = await runLookup(lng, lat, picked, controller.signal, current, (parcel) => set({ parcel }))
    if (!result || !current()) return
    inFlight = null
    set({ parcel: result })
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
    cancelDealRecord()
    set({ selectedId: null, parcel: { status: 'idle' }, dealRecord: null, placing: null, placementRequest: null, underwritingOpen: false })
  },

  setAsOf: (date) => set({ asOf: date }),
  setPersona: (persona) => set({ activePersona: persona }),
  openUnderwriting: (tab = 'Cash flow', scenario = 'base') => set({ underwritingOpen: true, underwritingTab: tab, underwritingScenario: scenario }),
  closeUnderwriting: () => set({ underwritingOpen: false }),
  setUnderwritingTab: (tab) => set({ underwritingTab: tab }),
  setUnderwritingScenario: (scenario) => set({ underwritingScenario: scenario }),
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
  resetScenarioPresets: (propertyId) =>
    set((s) => {
      const current = s.assumptionEdits[propertyId]
      if (!current) return {}
      const rest = Object.fromEntries(Object.entries(current).filter(([k]) => !k.startsWith(SCENARIO_KEY_PREFIX)))
      return { assumptionEdits: { ...s.assumptionEdits, [propertyId]: rest } }
    }),
  saveAssumptionSet: (propertyId, saved) =>
    set((s) => {
      const others = (s.assumptionSets[propertyId] ?? []).filter((x) => x.name !== saved.name)
      const { [propertyId]: _removed, ...otherEdits } = s.assumptionEdits
      const edits = { ...saved.edits }
      const property = s.properties.find((p) => p.id === propertyId)
      // Expense edits are keyed by line position: record the lines they were made on (when not the default single line).
      const { expenseLines: _old, ...rest } = saved
      const expenseLines = property ? recordedExpenseLines(property, s.asOf) : saved.expenseLines
      return {
        assumptionSets: { ...s.assumptionSets, [propertyId]: [...others, { ...rest, edits: { ...saved.edits }, ...(expenseLines ? { expenseLines } : {}) }] },
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
      const property = s.properties.find((p) => p.id === propertyId)
      const r = property ? reconcileExpenseEdits(property, s.asOf, saved.edits, saved.expenseLines, saved.name) : { edits: saved.edits, notice: null }
      const edits = { ...r.edits }
      const { [propertyId]: _notice, ...otherNotices } = s.assumptionNotices
      return {
        assumptionEdits: Object.keys(edits).length ? { ...otherEdits, [propertyId]: edits } : otherEdits,
        activeSets: { ...s.activeSets, [propertyId]: name },
        assumptionNotices: r.notice ? { ...otherNotices, [propertyId]: r.notice } : otherNotices,
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

  loadT12: (propertyId, statement) => {
    set((s) => swapT12(s, propertyId, statement))
    return saveT12s(get().t12s)
  },
  removeT12: (propertyId) => {
    if (!get().t12s[propertyId]) return
    set((s) => swapT12(s, propertyId, null))
    saveT12s(get().t12s)
  },
  dismissAssumptionNotice: (propertyId) =>
    set((s) => {
      const { [propertyId]: _removed, ...rest } = s.assumptionNotices
      return { assumptionNotices: rest }
    }),

  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  removeFilter: (chipKey) => set((s) => ({ filters: withoutFilter(s.filters, chipKey) })),
  clearFilters: () => set({ filters: EMPTY_FILTERS }),
  setSort: (sort) => set({ sort }),
  zoomToResults: () => set((s) => ({ zoomRequest: s.zoomRequest + 1 })),

  importDeal: (property) => {
    if (!property.importedFrom) throw new Error(`${property.id} is not an imported deal`)
    get().resetAssumptions(property.id)
    const placed = carryPlacement(get().properties.find((p) => p.id === property.id), withoutT12(property))
    // A re-imported rent roll keeps the deal's T-12.
    const t12 = get().t12s[property.id]
    const deal = t12 ? withT12(placed, t12) : placed
    const properties = [...get().properties.filter((p) => p.id !== property.id), deal]
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
      const { [id]: _t12, ...t12s } = s.t12s
      return { assumptionSets, t12s }
    })
    saveT12s(get().t12s)
    if (get().selectedId === id) get().clearSelection()
    const properties = get().properties.filter((p) => p.id !== id)
    set((s) => ({ properties, ...(s.placing?.dealId === id ? { placing: null, placementRequest: null } : {}) }))
    saveImportedDeals(properties)
  },

  loadDealRecord: async (id) => {
    cancelDealRecord()
    const p = get().properties.find((x) => x.id === id)
    const placement = p?.location.placement
    if (!p || !placement) return set({ dealRecord: null })
    const controller = new AbortController()
    dealRecordInFlight = controller
    const current = () => dealRecordInFlight === controller
    const { lng, lat } = p.location
    // Matched to the tax roll by the parcel's plat and lot, as an address-search pick is.
    const picked = { pin: placement.pin, address: placement.cityAddress }
    set({ dealRecord: { id, lookup: { status: 'loading', lng, lat, picked } } })

    const result = await runLookup(lng, lat, picked, controller.signal, current, (lookup) => set({ dealRecord: { id, lookup } }))
    if (!result || !current()) return
    dealRecordInFlight = null
    set({ dealRecord: { id, lookup: result } })
  },

  startPlacing: (id) => {
    cancelInFlight()
    set({ placing: { dealId: id, status: 'choosing' }, placementRequest: null, parcel: { status: 'idle' } })
  },
  cancelPlacing: () => {
    cancelInFlight()
    set({ placing: null, placementRequest: null })
  },

  findDealByAddress: async (id) => {
    const p = get().properties.find((x) => x.id === id)
    if (!p?.importedFrom) return { placed: false, candidates: [] }
    // Only the rent roll's address leaves the browser: never the deal's name, rents or tenants.
    const candidates = await searchParcelAddresses(p.location.address)
    const match = exactAddressMatch(candidates, p.location.address)
    if (!match) return { placed: false, candidates }
    await get().placeDeal(id, { pin: match.pin, address: match.address }, 'address')
    return { placed: true, candidates: [] }
  },

  placeDeal: async (id, target, method) => {
    cancelInFlight()
    const controller = new AbortController()
    inFlight = controller
    const current = () => inFlight === controller
    set({ placing: { dealId: id, status: 'locating' }, placementRequest: null, parcel: { status: 'idle' } })

    const gisController = new AbortController()
    controller.signal.addEventListener('abort', () => gisController.abort())
    const timer = setTimeout(() => gisController.abort(), GIS_TIMEOUT_MS)
    try {
      const [lng, lat] = 'pin' in target ? await parcelPointByPin(target.pin, gisController.signal) : [target.lng, target.lat]
      const { parcel, overlays } = await lookupParcelAt(lng, lat, gisController.signal)
      if (!current()) return
      // Streets and other unnumbered polygons in the parcel layer have no PIN (`parseParcelFeature` gives 'unknown').
      if (!parcel?.geometry || parcel.pin === 'unknown') throw new Error('No city parcel there. Click directly on a building or lot.')
      inFlight = null
      set({
        placementRequest: {
          dealId: id,
          pin: parcel.pin,
          // A searched parcel keeps the address it was found by.
          cityAddress: 'pin' in target ? target.address : (parcel.address?.value ?? `Parcel ${parcel.pin}`),
          method,
          point: interiorPoint(parcel.geometry),
          parcel: parcel.geometry,
          facts: parcelFacts(parcel, overlays),
        },
      })
    } catch (err) {
      if (!current()) return
      inFlight = null
      const message = gisController.signal.aborted
        ? `The city parcel layer didn't answer within ${GIS_TIMEOUT_MS / 1000} s.`
        : err instanceof Error
          ? err.message
          : 'Parcel lookup failed.'
      set({ placing: { dealId: id, status: 'failed', message } })
    } finally {
      clearTimeout(timer)
    }
  },

  completePlacement: (request, outline) => {
    const s = get()
    if (s.placementRequest !== request) return true
    const p = s.properties.find((x) => x.id === request.dealId)
    if (!p?.importedFrom) return true
    const placedAt = todayISO()
    const placement: DealPlacement = {
      pin: request.pin,
      cityAddress: request.cityAddress,
      method: request.method,
      placedAt,
      outlineFrom: outline ? 'osm' : 'parcel',
      ...(outline?.heightM !== undefined ? { heightM: outline.heightM } : {}),
    }
    const footprint = outline
      ? fromPublic(outline.ring, OSM_TILES_SOURCE, placedAt)
      : fromPublic(parcelOutline(request.parcel), PVD_SOURCE, placedAt)
    const properties = s.properties.map((x) => (x.id === p.id ? withPlacement(p, placement, request.point, footprint, request.facts) : x))
    // The old parcel's record no longer applies; the panel loads the new one.
    cancelDealRecord()
    set({ properties, dealRecord: null })
    get().select(p.id)
    return saveImportedDeals(properties)
  },

  resetDealLocation: (id) => {
    const p = get().properties.find((x) => x.id === id)
    if (!p?.importedFrom || !p.location.placement) return true
    cancelDealRecord()
    const properties = get().properties.map((x) => (x.id === id ? withoutPlacement(x) : x))
    set({ properties, dealRecord: null })
    return saveImportedDeals(properties)
  },
  toggleCitywide: () => {
    const { citywideVisible, citywide } = get()
    // After a failed load, turning it on again retries.
    if (citywideVisible && citywide.status !== 'error') return set({ citywideVisible: false, citywideListOpen: false })
    set({ citywideVisible: true })
    if (citywide.status !== 'off' && citywide.status !== 'error') return
    set({ citywide: { status: 'loading' } })
    loadCitywideSnapshot().then(
      ({ meta, parcels }) => {
        const rows = screeningRows(parcels)
        set({ citywide: { status: 'ready', meta, rows, byPin: new Map(rows.map((r) => [r.parcel.pin, r])), outlines: 'not-loaded' } })
      },
      (err: unknown) => set({ citywide: { status: 'error', message: err instanceof Error ? err.message : String(err) } }),
    )
  },

  loadCitywideOutlines: () => {
    const c = get().citywide
    if (c.status !== 'ready' || c.outlines !== 'not-loaded') return
    const withOutlines = (outlines: CitywideOutlines | 'loading' | 'failed') =>
      set((s) => (s.citywide.status === 'ready' ? { citywide: { ...s.citywide, outlines } } : {}))
    withOutlines('loading')
    // Without outlines the dots stay; nothing else depends on them.
    loadCitywideOutlines().then(withOutlines, () => withOutlines('failed'))
  },

  setCitywideListOpen: (open) => set({ citywideListOpen: open, ...(open ? { underwritingOpen: false } : {}) }),
  setCitywideFilter: (key, value) => set((s) => ({ citywideFilters: { ...s.citywideFilters, [key]: value } })),
  clearCitywideFilters: () => set({ citywideFilters: EMPTY_CITYWIDE_FILTERS }),
  setCitywideSort: (sort) => set({ citywideSort: sort }),

  openCitywideParcel: (pin, fly) => {
    const c = get().citywide
    const row = c.status === 'ready' ? c.byPin.get(pin) : undefined
    if (!row) return
    const [lng, lat] = row.parcel.point
    if (fly) set((s) => ({ mapFocus: { lng, lat, request: (s.mapFocus?.request ?? 0) + 1 } }))
    void get().lookupParcel(lng, lat, { pin, address: row.parcel.address })
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

/** The citywide screening row for a looked-up parcel (by searched PIN, city parcel PIN, or tax-roll plat and lot), once the layer has loaded. */
export function useCitywideRow(lookup: ParcelLookup): ScreeningRow | null {
  const citywide = useAppStore((s) => s.citywide)
  if (citywide.status !== 'ready' || lookup.status !== 'loaded') return null
  const pins = [
    lookup.picked?.pin,
    lookup.gis.status === 'ok' ? lookup.gis.parcel.pin : undefined,
    lookup.record ? platLotToPin(Number(lookup.record.plat), Number(lookup.record.lot)) : undefined,
  ]
  for (const pin of pins) {
    const row = pin && citywide.byPin.get(pin)
    if (row) return row
  }
  return null
}
