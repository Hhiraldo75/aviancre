import { create } from 'zustand'
import type { GisDetails, ISODate, ParcelLookup, Persona, Property, TaxRecord } from '../types'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { todayISO } from '../lib/metrics'
import { lookupParcelAt } from '../services/providenceGis'
import { lookupTaxRecord } from '../services/providenceOpenData'

/** The city GIS server is optional enrichment; give up on it after this long. */
const GIS_TIMEOUT_MS = 8000

/**
 * Single source of truth shared by the map and the side panel.
 * Filters, the lease-expiration timeline and underwriting assumptions will
 * live here too, so every view updates together.
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
  select: (id: string | null) => void
  lookupParcel: (lng: number, lat: number) => Promise<void>
  clearSelection: () => void
  setAsOf: (date: ISODate) => void
  setPersona: (persona: Persona) => void
  openUnderwriting: () => void
  closeUnderwriting: () => void
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
}))

export const useSelectedProperty = () =>
  useAppStore((s) => s.properties.find((p) => p.id === s.selectedId) ?? null)
