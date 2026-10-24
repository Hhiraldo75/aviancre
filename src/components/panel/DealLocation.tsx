import { useEffect, useState } from 'react'
import type { DealPlacement, Property } from '../../types'
import type { ParcelSuggestion } from '../../lib/addressSearch'
import { hasFileAddress } from '../../lib/importedDeals'
import { useAppStore } from '../../store/useAppStore'
import { Note } from '../ui/Card'
import AddressSearch from './AddressSearch'
import { PublicRecordBody, Status } from './ParcelDetail'

const HOW: Record<DealPlacement['method'], string> = {
  address: 'matched by the rent roll address',
  search: 'picked in the search',
  click: 'clicked on the map',
}

const button = 'rounded border border-slate-600 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-50'

/** Address search result for "Find … on the city map" when it didn't place the deal. */
type Found = { candidates: ParcelSuggestion[] } | { error: string }

/**
 * Where an imported deal sits on the map, and the actions that put it on its
 * real building or back on the approximate pin. Nothing about the deal is sent
 * anywhere until the analyst asks: "Find" sends only the rent roll's address.
 */
export default function DealLocation({ property: p }: { property: Property }) {
  const placing = useAppStore((s) => (s.placing?.dealId === p.id ? s.placing : null))
  const startPlacing = useAppStore((s) => s.startPlacing)
  const cancelPlacing = useAppStore((s) => s.cancelPlacing)
  const findDealByAddress = useAppStore((s) => s.findDealByAddress)
  const placeDeal = useAppStore((s) => s.placeDeal)
  const resetDealLocation = useAppStore((s) => s.resetDealLocation)
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const placement = p.location.placement
  const address = hasFileAddress(p) ? p.location.address : null

  useEffect(() => {
    if (!placing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelPlacing()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, cancelPlacing])

  const find = async () => {
    setFinding(true)
    setFound(null)
    try {
      const { placed, candidates } = await findDealByAddress(p.id)
      if (!placed) setFound({ candidates })
    } catch (err) {
      setFound({ error: err instanceof Error ? err.message : 'the search failed' })
    } finally {
      setFinding(false)
    }
  }

  const place = () => {
    setFound(null)
    startPlacing(p.id)
  }

  const reset = () => {
    if (!resetDealLocation(p.id)) window.alert('This browser would not save the change (storage is blocked or full). It lasts until you reload the page.')
  }

  return (
    <div className="mt-0.5 text-xs text-slate-400">
      <p>
        {placement ? (
          <>
            {p.location.address} · On the map at <span className="text-slate-200">{placement.cityAddress}</span> (city parcel{' '}
            {placement.pin}), {HOW[placement.method]}
          </>
        ) : (
          <>{p.location.address} · Map location approximate</>
        )}{' '}
        · Rent roll from {p.importedFrom?.fileName}
      </p>

      {placing ? (
        <div className="mt-2 rounded border border-blue-500/40 bg-blue-500/5 p-2.5">
          <p className="font-medium text-slate-100">Place {p.name} on the map</p>
          <p className="mb-2 mt-0.5 text-[11px]">Search the building’s address, or click the building on the map. Esc cancels.</p>
          <AddressSearch onPickParcel={(parcel) => void placeDeal(p.id, parcel, 'search')} />
          {placing.status === 'locating' && <p className="-mt-2 mb-2 text-[11px]">Finding the parcel and its building…</p>}
          {placing.status === 'failed' && <p className="-mt-2 mb-2 text-[11px] text-red-300">{placing.message}</p>}
          <button type="button" onClick={cancelPlacing} className={button}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!placement && address && (
            <button type="button" onClick={() => void find()} disabled={finding} className={button}>
              {finding ? 'Searching city parcels…' : `Find ${address} on the city map`}
            </button>
          )}
          <button type="button" onClick={place} className={button}>
            {placement ? 'Move to another building' : 'Place on map'}
          </button>
          {placement && (
            <button type="button" onClick={reset} className={button}>
              Reset to approximate location
            </button>
          )}
        </div>
      )}

      {!placement && !placing && address && !found && (
        <p className="mt-1 text-[11px] text-slate-500">Find sends only this address to the city’s parcel search, nothing else about the deal.</p>
      )}

      {found && !placing && 'error' in found && (
        <p className="mt-1.5 text-[11px] text-amber-300">City parcel search is unavailable right now ({found.error}). Use Place on map to click the building.</p>
      )}
      {found && !placing && 'candidates' in found && (
        <div className="mt-1.5 text-[11px]">
          {found.candidates.length ? (
            <>
              <p>No single city parcel is at exactly “{address}”. Pick the right one, or use Place on map:</p>
              <ul className="mt-1 space-y-0.5">
                {found.candidates.map((c) => (
                  <li key={c.pin}>
                    <button
                      type="button"
                      onClick={() => void placeDeal(p.id, { pin: c.pin, address: c.address }, 'search')}
                      className="text-left text-blue-300 hover:underline"
                    >
                      {c.address}
                      {c.units > 1 ? ` (${c.units} units)` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No city parcel matches “{address}”. Use Place on map to search another spelling or click the building.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** The public record of the parcel a deal is placed on, looked up when the deal is opened. */
export function DealPublicRecord({ property: p }: { property: Property }) {
  const placement = p.location.placement
  const load = useAppStore((s) => s.loadDealRecord)
  const lookup = useAppStore((s) => (s.dealRecord?.id === p.id ? s.dealRecord.lookup : null))

  useEffect(() => {
    if (placement) void load(p.id)
  }, [p.id, placement, load])

  if (!placement || !lookup || lookup.status === 'idle') return null
  return (
    <section className="mb-4">
      <h3 className="text-sm font-semibold">Public record · {placement.cityAddress}</h3>
      {lookup.status === 'loading' && (
        <div className="mt-2">
          <Status title="Looking up public records…" body="Checking the Providence tax roll and city GIS for this parcel." spinner />
        </div>
      )}
      {lookup.status === 'not-found' && (
        <div className="mt-2">
          <Note>The tax roll and city GIS have no record for this parcel.</Note>
        </div>
      )}
      {lookup.status === 'error' && (
        <div className="mt-2">
          <Status title="Couldn't load public records" body={`${lookup.message}. Check your connection and try again.`}>
            <button onClick={() => void load(p.id)} className="mt-3 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600">
              Try again
            </button>
          </Status>
        </div>
      )}
      {lookup.status === 'loaded' && <PublicRecordBody record={lookup.record} gis={lookup.gis} />}
    </section>
  )
}
