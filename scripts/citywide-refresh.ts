/**
 * Pulls the public inputs for the citywide screening estimates and writes the
 * snapshot the app lazy-loads when "Citywide estimates" is turned on:
 *
 *   npm run citywide:refresh
 *
 * Sources: the 2025 tax roll (every commercial lot under the RI class 2 rule),
 * the city parcel layer for those lots (building area, units, year built,
 * outline), the city's official neighborhoods, and OpenStreetMap office/shop
 * features (Overpass, called here only, never by the app).
 *
 * Writes public/data/citywide/parcels.json (inputs + coverage),
 * public/data/citywide/outlines.json (simplified outlines) and
 * docs/citywide-coverage.md, and prints the coverage report.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MultiPolygon, Polygon } from 'geojson'
import { coverageLines, coverageReport } from '../src/lib/citywide/coverage'
import { estimateParcel, SCREENING_LABEL } from '../src/lib/citywide/estimate'
import { joinParcels, OSM_RETAIL_AMENITIES, osmKind, type OsmFeature, type TaxRollRow } from '../src/lib/citywide/join'
import { simplifyGeometry } from '../src/lib/citywide/outline'
import type { CitywideOutlines, CitywideSnapshot } from '../src/lib/citywide/types'
import { decodeLandUse } from '../src/lib/landUse'
import { LAYERS, PVD_NEIGHBORHOODS_LAYER, pvdLayer, type Feature, type FeatureCollection } from '../src/services/providenceGis'
import { TAX_ROLL_URL } from '../src/services/providenceOpenData'

const OUT_DIR = resolve('public/data/citywide')
const COVERAGE_DOC = resolve('docs/citywide-coverage.md')
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
/** South, west, north, east: the city plus a margin; parcels outside it get no OSM features. */
const CITY_BBOX = '41.77,-71.48,41.865,-71.37'
const PIN_BATCH = 150
const PARCEL_FIELDS = 'PIN,ParcAddress,UnitNum,MuniUseCode,AssessedValueTotal,YearBuilt,GrBldgArea,AreaAC,NumUnits,NumFloors,StateUse,Owner1,ZONING'

async function getJSON<T>(url: string, init?: RequestInit, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': 'aviancre-citywide-refresh', ...init?.headers } })
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
      const body = (await res.json()) as T & { error?: { message?: string } }
      if (body && typeof body === 'object' && 'error' in body && body.error) throw new Error(body.error.message ?? 'service error')
      return body
    } catch (err) {
      if (attempt >= tries) throw err
      console.warn(`  retrying (${(err as Error).message})`)
      await new Promise((r) => setTimeout(r, 3_000 * attempt))
    }
  }
}

async function taxRoll(): Promise<TaxRollRow[]> {
  const classes = await getJSON<{ class?: string }[]>(`${TAX_ROLL_URL}?${new URLSearchParams({ $select: 'class', $group: 'class', $limit: '1000' })}`)
  const commercial = classes.map((c) => c.class).filter((c): c is string => !!c && !!decodeLandUse(c)?.isCommercial)
  const where = `class in(${commercial.map((c) => `'${c}'`).join(',')})`
  const rows = await getJSON<TaxRollRow[]>(`${TAX_ROLL_URL}?${new URLSearchParams({ $where: where, $limit: '50000', $order: 'p_id' })}`)
  if (rows.length >= 50_000) throw new Error('Tax roll hit the 50,000-row page limit; page the query')
  return rows
}

async function cityParcels(pins: string[]): Promise<Feature[]> {
  const batches: string[][] = []
  for (let i = 0; i < pins.length; i += PIN_BATCH) batches.push(pins.slice(i, i + PIN_BATCH))
  const features: Feature[] = []
  for (let i = 0; i < batches.length; i += 4) {
    const pages = await Promise.all(
      batches.slice(i, i + 4).map((batch) => {
        const params = new URLSearchParams({
          where: `PIN IN (${batch.map((p) => `'${p}'`).join(',')})`,
          outFields: PARCEL_FIELDS,
          returnGeometry: 'true',
          outSR: '4326',
          resultRecordCount: '2000',
          f: 'geojson',
        })
        return getJSON<FeatureCollection & { exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } }>(
          `${pvdLayer(LAYERS.parcels)}/query`,
          { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        )
      }),
    )
    for (const page of pages) {
      if (page.exceededTransferLimit || page.properties?.exceededTransferLimit) throw new Error('Parcel query hit the record limit; lower PIN_BATCH')
      features.push(...page.features)
    }
    process.stdout.write(`\r  city parcels: ${Math.min(i + 4, batches.length)}/${batches.length} batches`)
  }
  process.stdout.write('\n')
  return features
}

async function neighborhoods() {
  const params = new URLSearchParams({ where: '1=1', outFields: 'LNAME', returnGeometry: 'true', outSR: '4326', f: 'geojson' })
  const fc = await getJSON<FeatureCollection>(`${PVD_NEIGHBORHOODS_LAYER}/query?${params}`)
  return fc.features.flatMap((f) => {
    const name = (f.properties as { LNAME?: string } | null)?.LNAME
    const g = f.geometry
    return name && g && (g.type === 'Polygon' || g.type === 'MultiPolygon') ? [{ name, geometry: g as Polygon | MultiPolygon }] : []
  })
}

async function osmFeatures(): Promise<OsmFeature[]> {
  const b = CITY_BBOX
  const query =
    `[out:json][timeout:120];(nwr["shop"](${b});nwr["office"](${b});nwr["building"~"^(office|retail|supermarket|kiosk)$"](${b});` +
    `nwr["amenity"~"^(${OSM_RETAIL_AMENITIES.join('|')})$"](${b}););out center tags;`
  type Element = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
  const body = await getJSON<{ elements: Element[] }>(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return body.elements.flatMap((e) => {
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null)
    const kind = osmKind(e.tags ?? {})
    return at && kind ? [{ point: [at.lon, at.lat] as [number, number], kind }] : []
  })
}

console.log('Citywide screening estimates: refreshing public inputs')
console.log('  tax roll…')
const taxRows = await taxRoll()
const pins = [...new Set(taxRows.map((r) => `${Number(r.plat) * 10_000 + Number(r.lot)}`))]
console.log(`  ${taxRows.length} commercial tax-roll records on ${pins.length} lots`)
const gisFeatures = await cityParcels(pins)
console.log('  neighborhoods…')
const hoods = await neighborhoods()
console.log('  OpenStreetMap (Overpass)…')
const osm = await osmFeatures()
console.log(`  ${hoods.length} neighborhoods, ${osm.length} OpenStreetMap office/shop features`)

const { parcels, outlines, stats } = joinParcels({ taxRows, gisFeatures, neighborhoods: hoods, osm })
const results = parcels.map(estimateParcel)
const coverage = coverageReport(stats, parcels, results)
const generatedAt = new Date().toISOString().slice(0, 10)

const snapshot: CitywideSnapshot = {
  meta: {
    generatedAt,
    sources: [
      { name: 'City of Providence Open Data – 2025 Property Tax Roll', url: TAX_ROLL_URL },
      { name: 'City of Providence ArcGIS Online – Parcels with CAMA (Parcel_Zoning_FL)', url: pvdLayer(LAYERS.parcels) },
      { name: 'City of Providence ArcGIS Online – Providence Neighborhoods', url: PVD_NEIGHBORHOODS_LAYER },
      { name: 'OpenStreetMap contributors (ODbL), via the Overpass API', url: OVERPASS_URL },
    ],
    coverage,
  },
  parcels,
}

// Outlines only for lots the map draws: vacant land and utilities appear in the list alone.
const drawn = new Set(results.filter((r) => r.status === 'estimated' || r.reason === 'no-building-area' || r.reason === 'no-income').map((r) => r.pin))
const light: CitywideOutlines = Object.fromEntries(Object.entries(outlines).filter(([pin]) => drawn.has(pin)).map(([pin, g]) => [pin, simplifyGeometry(g)]))

mkdirSync(OUT_DIR, { recursive: true })
const parcelsJson = JSON.stringify(snapshot)
const outlinesJson = JSON.stringify(light)
writeFileSync(resolve(OUT_DIR, 'parcels.json'), parcelsJson)
writeFileSync(resolve(OUT_DIR, 'outlines.json'), outlinesJson)

const lines = coverageLines(coverage)
writeFileSync(
  COVERAGE_DOC,
  [
    '# Citywide screening estimates: coverage',
    '',
    `Snapshot of ${generatedAt}, from \`npm run citywide:refresh\`. ${SCREENING_LABEL}; method in [UNDERWRITING.md](UNDERWRITING.md#citywide-screening-estimates).`,
    'The estimate and ratio counts are at the benchmarks of the refresh; the app recomputes them from the snapshot.',
    '',
    ...lines,
    '',
    'Sources:',
    '',
    ...snapshot.meta.sources.map((s) => `- ${s.name}: ${s.url}`),
    '',
  ].join('\n'),
)

console.log(`\n${SCREENING_LABEL}. Coverage, ${generatedAt}:\n`)
console.log(lines.join('\n'))
const kb = (s: string) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`
console.log(`\nWrote public/data/citywide/parcels.json (${kb(parcelsJson)}), outlines.json (${kb(outlinesJson)}) and docs/citywide-coverage.md`)
