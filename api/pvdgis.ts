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
/** Under the function's maxDuration in vercel.json and the app's GIS_TIMEOUT_MS. */
export const TIMEOUT_MS = 20_000
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

/** Error codes Node's fetch puts on `cause` (or on each of `cause.errors` when every address failed). */
function errorCodes(err: unknown): string[] {
  const cause = (err as { cause?: { code?: unknown; errors?: unknown[] } } | null)?.cause
  const all = [cause, ...(Array.isArray(cause?.errors) ? cause.errors : [])]
  return all.map((e) => (e as { code?: unknown } | null)?.code).filter((c): c is string => typeof c === 'string')
}

/** Why the city server could not be reached, as a status and a message naming the failure. */
export function describeFailure(err: unknown, elapsedMs: number): { status: number; message: string } {
  const after = `after ${(elapsedMs / 1000).toFixed(1)} s`
  if ((err as { name?: unknown } | null)?.name === 'TimeoutError') {
    return { status: 504, message: `City GIS server timed out: no answer ${after}` }
  }
  const codes = errorCodes(err)
  const code = codes[0] ?? 'unknown'
  const has = (...wanted: string[]) => codes.some((c) => wanted.includes(c))
  if (has('UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT')) {
    return { status: 504, message: `City GIS server timed out: could not connect ${after} (${code})` }
  }
  if (has('ENOTFOUND', 'EAI_AGAIN')) return { status: 502, message: `City GIS server DNS lookup failed (${code})` }
  if (has('ECONNREFUSED')) return { status: 502, message: `City GIS server refused the connection (${code})` }
  if (has('ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET')) {
    return { status: 502, message: `City GIS server dropped the connection ${after} (${code})` }
  }
  if (codes.some((c) => /CERT|TLS|SSL/.test(c))) return { status: 502, message: `City GIS server TLS error (${code})` }
  const detail = err instanceof Error ? err.message : String(err)
  return { status: 502, message: `City GIS server unreachable: ${detail} (${code})` }
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const target = upstreamUrl(query.get('path') ?? '', query)
  if (!target) return json(400, 'Not an allowed City GIS query')

  let res: Response
  let body: string
  const started = Date.now()
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } })
    body = await res.text()
  } catch (err) {
    const { status, message } = describeFailure(err, Date.now() - started)
    return json(status, message)
  }
  if (!res.ok && !/^\s*\{/.test(body)) return json(res.status, `City GIS server answered HTTP ${res.status}`)
  // ArcGIS reports query errors as HTTP 200 with an {"error": …} body; don't cache those.
  const cacheable = res.ok && !/^\s*\{\s*"error"/.test(body)
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheable ? CACHE_OK : 'no-store' },
  })
}
