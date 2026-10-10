/**
 * Vercel function: a US relay for the City of Providence GIS, which is blocked
 * from some non-US networks and isn't reachable from the browser in production.
 *
 * vercel.json rewrites /pvdgis/<path> to /api/pvdgis?path=<path>, the same URLs
 * the Vite dev proxy serves, so src/services/providenceGis.ts needs no change.
 * Only the layer queries that file sends are forwarded: a new layer or query
 * parameter there must be added here too (src/services/pvdgisRelay.test.ts checks).
 */

const UPSTREAM = 'https://webgis.providenceri.gov'
const QUERY_PATH = /^server\/rest\/services\/Viewpoint_Base\/MapServer\/(\d+)\/query$/
/** Flood, base zoning, local historic districts, parcels (LAYERS in providenceGis.ts). */
const LAYERS = new Set(['0', '4', '12', '14'])
const PARAMS = ['geometry', 'geometryType', 'inSR', 'spatialRel', 'outFields', 'returnGeometry', 'outSR', 'f'] as const
const TIMEOUT_MS = 7_000
const CACHE_OK = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

/** The city GIS URL for an allowed layer query, or null for anything else. */
export function upstreamUrl(path: string, query: URLSearchParams): string | null {
  const layer = QUERY_PATH.exec(path)?.[1]
  if (!layer || !LAYERS.has(layer) || query.get('f') !== 'geojson') return null
  const params = new URLSearchParams()
  for (const key of PARAMS) {
    const value = query.get(key)
    if (value !== null) params.set(key, value)
  }
  return `${UPSTREAM}/${path}?${params.toString()}`
}

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const target = upstreamUrl(query.get('path') ?? '', query)
  if (!target) return json(400, 'Not an allowed City GIS query')

  let res: Response
  let body: string
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } })
    body = await res.text()
  } catch {
    return json(502, 'City GIS server did not respond')
  }
  // ArcGIS reports query errors as HTTP 200 with an {"error": …} body; don't cache those.
  const cacheable = res.ok && !/^\s*\{\s*"error"/.test(body)
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheable ? CACHE_OK : 'no-store' },
  })
}
