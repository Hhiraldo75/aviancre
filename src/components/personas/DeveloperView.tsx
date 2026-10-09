import type { Property } from '../../types'
import { ZONING_LIMITS } from '../../data/zoning'
import { developmentCapacity } from '../../lib/development'
import { fmt } from '../../lib/format'
import { Card, Note, Stat, StatGrid } from '../ui/Card'

export default function DeveloperView({ property: p }: { property: Property }) {
  const d = developmentCapacity(p)
  const z = p.zoning
  const ph = p.physical
  const capacity = d.additionalBuildableSF

  return (
    <div className="space-y-4">
      <Card title="Municipal zoning">
        <StatGrid>
          <Stat label="District" value={z.district.value} src={z.district} hint={ZONING_LIMITS[z.district.value]?.description} />
          <Stat label="Flood zone" value={z.floodZone?.value ?? 'Not mapped'} src={z.floodZone} tone="warn" hint={z.floodZone?.value.startsWith('A') ? 'Special flood hazard area' : undefined} />
          <Stat label="Max height" value={z.maxHeightFt ? `${z.maxHeightFt.value} ft` : '—'} src={z.maxHeightFt} />
          <Stat label="Max FAR" value={z.maxFAR ? z.maxFAR.value.toFixed(1) : '—'} src={z.maxFAR} />
        </StatGrid>
        <Note>Zoning limits are placeholders. Verify district, overlays and bonuses against the Providence Zoning Ordinance.</Note>
      </Card>

      <Card title="Development capacity">
        <StatGrid>
          <Stat label="Building height" value={`${Math.round(d.heightFt)} ft`} hint={d.heightIsEstimate ? 'Estimated from floor count' : undefined} />
          <Stat
            label="Height headroom"
            value={d.heightHeadroomFt !== null ? `${Math.round(d.heightHeadroomFt)} ft` : '—'}
            tone={d.heightHeadroomFt !== null && d.heightHeadroomFt < 0 ? 'warn' : 'good'}
            hint={d.heightHeadroomFt !== null && d.heightHeadroomFt < 0 ? 'Taller than current limit' : undefined}
          />
          <Stat label="Existing FAR" value={d.existingFAR !== null ? d.existingFAR.toFixed(2) : '—'} />
          <Stat label="Max buildable" value={d.maxBuildableSF !== null ? fmt.sf(d.maxBuildableSF) : '—'} />
        </StatGrid>
        {capacity !== null && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-xs ${
              capacity > 0 ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200'
            }`}
          >
            {capacity > 0 ? (
              <>
                <span className="font-semibold">{fmt.sf(capacity)}</span> of unused development rights under current zoning
              </>
            ) : (
              <>
                Exceeds current zoning by <span className="font-semibold">{fmt.sf(-capacity)}</span>, likely legal non-conforming.
                Redevelopment could not rebuild at today's size.
              </>
            )}
          </div>
        )}
      </Card>

      <Card title="Physical & structural specs">
        <StatGrid>
          <Stat label="Gross building area" value={fmt.sf(ph.grossBuildingSF.value)} src={ph.grossBuildingSF} />
          <Stat label="Rentable area" value={fmt.sf(ph.rentableSF.value)} src={ph.rentableSF} />
          <Stat label="Land area" value={ph.landAreaSF ? `${fmt.sf(ph.landAreaSF.value)} (${(ph.landAreaSF.value / 43_560).toFixed(2)} ac)` : '—'} src={ph.landAreaSF} />
          <Stat label="Floors" value={String(ph.floors.value)} src={ph.floors} />
          <Stat label="Year built" value={ph.yearBuilt ? String(ph.yearBuilt.value) : '—'} src={ph.yearBuilt} />
          <Stat label="Renovated" value={ph.yearRenovated ? String(ph.yearRenovated.value) : '—'} src={ph.yearRenovated} />
          {ph.parkingSpaces && <Stat label="Parking" value={`${ph.parkingSpaces.value} spaces`} src={ph.parkingSpaces} />}
          {ph.unitCount && <Stat label="Units" value={String(ph.unitCount.value)} src={ph.unitCount} />}
          {ph.clearHeightFt && <Stat label="Clear height" value={`${ph.clearHeightFt.value} ft`} src={ph.clearHeightFt} />}
          {ph.loadingDocks && <Stat label="Dock doors" value={String(ph.loadingDocks.value)} src={ph.loadingDocks} />}
        </StatGrid>
      </Card>
    </div>
  )
}
