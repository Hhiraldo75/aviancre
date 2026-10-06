import type { ReactNode } from 'react'
import type { GisDetails, ParcelLookup, TaxRecord } from '../../types'
import { fmt } from '../../lib/format'
import { normalizeZoningCode, parcelMetrics } from '../../lib/parcelMetrics'
import { useAppStore } from '../../store/useAppStore'
import { Card, Chip, Note, Stat, StatGrid } from '../ui/Card'

/** Public record for any clicked spot: Providence tax roll, plus city GIS details when reachable. */
export default function ParcelDetail({ lookup }: { lookup: Exclude<ParcelLookup, { status: 'idle' }> }) {
  const clear = useAppStore((s) => s.clearSelection)
  const retry = useAppStore((s) => s.lookupParcel)

  return (
    <div>
      <button onClick={clear} className="mb-2 text-xs text-slate-400 hover:text-slate-100">
        ← All properties
      </button>

      {lookup.status === 'loading' && <Status title="Looking up public records…" body="Checking the Providence tax roll and city GIS." spinner />}

      {lookup.status === 'not-found' && (
        <Status title="No property record here" body="Streets, parks and water usually have no record. Click directly on a building or lot." />
      )}

      {lookup.status === 'error' && (
        <Status title="Couldn't load public records" body={`${lookup.message}. Check your connection and try again.`}>
          <button
            onClick={() => void retry(lookup.lng, lookup.lat)}
            className="mt-3 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
          >
            Try again
          </button>
        </Status>
      )}

      {lookup.status === 'loaded' && <Loaded record={lookup.record} gis={lookup.gis} />}
    </div>
  )
}

function Loaded({ record: r, gis }: { record: TaxRecord | null; gis: GisDetails }) {
  const g = gis.status === 'ok' ? gis : null
  const title = r?.address?.value ?? g?.parcel.address?.value ?? `Parcel ${r?.taxMap ?? g?.parcel.pin ?? ''}`
  const zoning = g?.overlays.baseZoning?.value ?? g?.parcel.parcelZoning?.value

  return (
    <>
      <h2 className="text-lg font-semibold leading-tight">{title}</h2>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        <Chip>Public record</Chip>
        {r && <Chip>Plat {r.plat} · Lot {r.lot}</Chip>}
        {r?.landUse && <Chip>{r.landUse.value}</Chip>}
        {zoning && <Chip>{zoning}</Chip>}
      </div>

      <div className="mt-4 space-y-4">
        {r ? <TaxRollCard r={r} /> : <Note>No tax-roll record near this spot; showing city GIS details only.</Note>}
        <GisSection gis={gis} record={r} />
        <Note>
          No rents or tenants for this property yet. Market-based rent estimates and rent-roll import are later milestones;
          persona views currently apply to the sample properties.
        </Note>
      </div>
    </>
  )
}

function TaxRollCard({ r }: { r: TaxRecord }) {
  const taxable = (r.assessedValue?.value ?? 0) - (r.exemptValue?.value ?? 0)
  const effectiveRate = r.annualTaxes && taxable > 0 ? r.annualTaxes.value / taxable : null
  const fullyExempt = r.assessedValue && r.exemptValue && r.exemptValue.value >= r.assessedValue.value && r.assessedValue.value > 0

  return (
    <Card title="Tax roll (2025)">
      <StatGrid>
        <Stat label="Owner" value={r.owner?.value ?? '—'} src={r.owner} />
        <Stat label="Land use" value={r.landUse?.value ?? '—'} hint={r.landUseCode ? `Class ${r.landUseCode}` : undefined} src={r.landUse} />
        <Stat label="Assessed value" value={r.assessedValue ? fmt.usd(r.assessedValue.value) : '—'} src={r.assessedValue} />
        <Stat
          label="Annual taxes"
          value={r.annualTaxes ? fmt.usd(r.annualTaxes.value) : '—'}
          hint={fullyExempt ? 'Fully tax-exempt' : effectiveRate !== null ? `${(effectiveRate * 1000).toFixed(2)} per $1,000 taxable` : undefined}
          src={r.annualTaxes}
        />
        {r.exemptValue && r.exemptValue.value > 0 && !fullyExempt && <Stat label="Exempt value" value={fmt.usd(r.exemptValue.value)} src={r.exemptValue} />}
        {r.unitCount > 1 && (
          <Stat
            label="Units on this lot"
            value={fmt.int(r.unitCount)}
            hint={r.totalAssessedAllUnits ? `${fmt.usdCompact(r.totalAssessedAllUnits)} assessed, all units` : undefined}
          />
        )}
      </StatGrid>
      <Note>
        Closest tax-roll record to your click ({Math.round(r.distanceM)} m away). Tax map {r.taxMap}.
      </Note>
    </Card>
  )
}

function GisSection({ gis, record }: { gis: GisDetails; record: TaxRecord | null }) {
  if (gis.status === 'loading') {
    return <Status title="Checking city GIS…" body="Zoning, flood zone, building size and parcel outline." spinner />
  }
  if (gis.status === 'unavailable') {
    return (
      <Card title="Zoning & building details">
        <p className="text-xs text-slate-400">
          The City of Providence GIS server isn't reachable from your network ({gis.reason}). Zoning, flood zone, year built,
          building size and the parcel outline will appear when it is, for example on a US connection or once AVIANCRE is deployed.
        </p>
      </Card>
    )
  }
  if (gis.status === 'none') return null

  const { parcel: p, overlays: o } = gis
  const zoningCode = o.baseZoning?.value ?? p.parcelZoning?.value
  // Use the tax-roll value when the GIS record lacks one.
  const m = parcelMetrics({ ...p, assessedValue: p.assessedValue ?? record?.assessedValue }, zoningCode)
  const flood = o.floodZone?.value
  const inSFHA = flood ? /^(A|V)/.test(flood.toUpperCase()) : false
  const parcelZoningDiffers =
    p.parcelZoning && o.baseZoning && normalizeZoningCode(p.parcelZoning.value) !== normalizeZoningCode(o.baseZoning.value)

  return (
    <>
      <Card title="Building & lot">
        <StatGrid>
          <Stat label="Year built" value={p.yearBuilt ? String(p.yearBuilt.value) : '—'} src={p.yearBuilt} />
          <Stat label="Gross building area" value={p.grossBuildingSF ? fmt.sf(p.grossBuildingSF.value) : '—'} src={p.grossBuildingSF} />
          <Stat
            label="Land area"
            value={p.landAreaSF ? fmt.sf(p.landAreaSF.value) : '—'}
            hint={p.landAreaSF ? `${(p.landAreaSF.value / 43_560).toFixed(2)} acres` : undefined}
            src={p.landAreaSF}
          />
          <Stat label="Assessed $/SF" value={m.assessedPerBuildingSF !== null ? `${fmt.usd(m.assessedPerBuildingSF)}/SF` : '—'} hint="Assessed value ÷ building area" />
          <Stat label="Existing FAR" value={m.existingFAR !== null ? m.existingFAR.toFixed(2) : '—'} hint="Building area ÷ land area" />
          <Stat
            label="Unused capacity"
            value={m.additionalBuildableSF !== null ? fmt.sf(Math.round(m.additionalBuildableSF)) : '—'}
            tone={m.additionalBuildableSF !== null && m.additionalBuildableSF < 0 ? 'warn' : 'good'}
            hint={m.placeholderMaxFAR !== null ? `vs. placeholder max FAR ${m.placeholderMaxFAR.toFixed(1)}` : 'District not in table yet'}
          />
        </StatGrid>
        <Note>Max FAR comes from AVIANCRE's placeholder zoning table, not the ordinance. Verify before relying on it.</Note>
      </Card>

      <Card title="Zoning & environment">
        <StatGrid>
          <Stat label="Base zoning" value={o.baseZoning?.value ?? '—'} hint={o.baseZoningDistrict?.value} src={o.baseZoning} />
          <Stat label="Flood zone" value={flood ?? 'Not in mapped flood area'} src={o.floodZone} tone="warn" hint={inSFHA ? 'Special flood hazard area' : undefined} />
          <Stat label="Historic district" value={o.historicDistrict?.value ?? 'None'} src={o.historicDistrict} />
          {parcelZoningDiffers && <Stat label="Zoning on parcel" value={p.parcelZoning!.value} src={p.parcelZoning} hint="Differs from zoning map" tone="warn" />}
        </StatGrid>
      </Card>
    </>
  )
}

function Status({ title, body, spinner, children }: { title: string; body: string; spinner?: boolean; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {spinner && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />}
        {title}
      </div>
      <p className="mt-1 text-xs text-slate-400">{body}</p>
      {children}
    </div>
  )
}
