import { create } from 'zustand'
import type { ISODate, Persona, Property } from '../types'
import { SAMPLE_PROPERTIES } from '../data/sampleProperties'
import { todayISO } from '../lib/metrics'

/**
 * Single source of truth shared by the map and the side panel.
 * Filters, the lease-expiration timeline and underwriting assumptions will
 * live here too, so every view updates together.
 */
interface AppState {
  properties: Property[]
  selectedId: string | null
  /** Analysis date for occupancy and rent calculations. */
  asOf: ISODate
  /** Which professional lens the sidebar shows. */
  activePersona: Persona
  select: (id: string | null) => void
  setAsOf: (date: ISODate) => void
  setPersona: (persona: Persona) => void
}

export const useAppStore = create<AppState>()((set) => ({
  properties: SAMPLE_PROPERTIES,
  selectedId: null,
  asOf: todayISO(),
  activePersona: 'Analyst',
  select: (id) => set({ selectedId: id }),
  setAsOf: (date) => set({ asOf: date }),
  setPersona: (persona) => set({ activePersona: persona }),
}))

export const useSelectedProperty = () =>
  useAppStore((s) => s.properties.find((p) => p.id === s.selectedId) ?? null)
