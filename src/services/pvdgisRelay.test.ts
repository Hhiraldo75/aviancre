import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, TIMEOUT_MS, describeFailure, upstreamUrl } from '../../api/pvdgis'
import { LAYERS, PVD_GIS_BASE, pointQueryUrl } from './providenceGis'

/** What the relay sees after the vercel.json rewrite of an app URL. */
function relayed(appUrl: string): { path: string; query: URLSearchParams } {
  const url = new URL(appUrl, 'https://aviancre.example')
  const query = new URLSearchParams(url.search)
  const path = url.pathname.replace(/^\/pvdgis\//, '')
  query.set('path', path)
  return { path, query }
}

const PARCEL_URL = pointQueryUrl(LAYERS.parcels, -71.41, 41.82, ['PIN'], true)

describe('upstreamUrl', () => {
  it('allows every query the app sends, to the city server only', () => {
    expect(PVD_GIS_BASE.startsWith('/pvdgis/')).toBe(true)
    for (const layer of Object.values(LAYERS)) {
      const { path, query } = relayed(pointQueryUrl(layer, -71.41, 41.82, '*', false))
      const target = upstreamUrl(path, query)
      expect(target).not.toBeNull()
      const url = new URL(target!)
      expect(url.origin).toBe('https://webgis.providenceri.gov')
      expect(url.pathname).toBe(`/server/rest/services/Viewpoint_Base/MapServer/${layer}/query`)
      expect(url.searchParams.get('f')).toBe('geojson')
      expect(url.searchParams.has('path')).toBe(false)
    }
  })

  it('refuses other services, layers, endpoints and traversal', () => {
    const q = relayed(PARCEL_URL).query
    for (const path of [
      'server/rest/services/Viewpoint_Base/MapServer/3/query',
      'server/rest/services/Other/MapServer/14/query',
      'server/rest/services/Viewpoint_Base/MapServer/14',
      'server/rest/services/Viewpoint_Base/MapServer/14/query/../../../admin',
      'server/rest/services/Viewpoint_Base/MapServer/14/query?x=1',
      '//evil.example/server/rest/services/Viewpoint_Base/MapServer/14/query',
      '',
    ]) {
      expect(upstreamUrl(path, q)).toBeNull()
    }
  })

  it('requires f=geojson and drops parameters the app never sends', () => {
    const { path, query } = relayed(PARCEL_URL)
    query.set('f', 'html')
    expect(upstreamUrl(path, query)).toBeNull()
    query.delete('f')
    expect(upstreamUrl(path, query)).toBeNull()

    query.set('f', 'geojson')
    query.set('where', '1=1')
    query.set('token', 'x')
    const url = new URL(upstreamUrl(path, query)!)
    expect(url.searchParams.has('where')).toBe(false)
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.get('geometry')).toBe('-71.41,41.82')
  })
})

describe('GET', () => {
  afterEach(() => vi.unstubAllGlobals())

  const request = (query: URLSearchParams) => new Request(`https://aviancre.example/api/pvdgis?${query.toString()}`)

  it('forwards an allowed query and caches a good answer briefly', async () => {
    const fetchMock = vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await GET(request(relayed(PARCEL_URL).query))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 'FeatureCollection', features: [] })
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/webgis\.providenceri\.gov\/server\/rest\/services\/Viewpoint_Base\/MapServer\/14\/query\?/)
  })

  it('does not cache ArcGIS errors or failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":400,"message":"Invalid"}}', { status: 200 })))
    expect((await GET(request(relayed(PARCEL_URL).query))).headers.get('Cache-Control')).toBe('no-store')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    const res = await GET(request(relayed(PARCEL_URL).query))
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('City GIS server answered HTTP 503')
  })

  it('says which failure it was when the city server is unreachable', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    vi.stubGlobal('fetch', vi.fn(async () => { throw refused }))
    const res = await GET(request(relayed(PARCEL_URL).query))
    expect(res.status).toBe(502)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('City GIS server refused the connection (ECONNREFUSED)')
  })

  it('answers 400 without calling the city server for a disallowed path', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const query = relayed(PARCEL_URL).query
    query.set('path', 'server/rest/services/Viewpoint_Base/MapServer/14/applyEdits')
    const res = await GET(request(query))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('describeFailure', () => {
  const failed = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause })

  it('names timeouts, with how long it waited', () => {
    expect(TIMEOUT_MS).toBe(20_000)
    expect(describeFailure(new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 20_004)).toEqual({
      status: 504,
      message: 'City GIS server timed out: no answer after 20.0 s',
    })
    expect(describeFailure(failed({ code: 'UND_ERR_CONNECT_TIMEOUT' }), 10_012)).toEqual({
      status: 504,
      message: 'City GIS server timed out: could not connect after 10.0 s (UND_ERR_CONNECT_TIMEOUT)',
    })
  })

  it('names DNS, refused, reset and TLS failures', () => {
    expect(describeFailure(failed({ code: 'ENOTFOUND' }), 30).message).toBe('City GIS server DNS lookup failed (ENOTFOUND)')
    expect(describeFailure(failed({ code: 'ECONNREFUSED' }), 30).message).toBe('City GIS server refused the connection (ECONNREFUSED)')
    expect(describeFailure(failed({ code: 'ECONNRESET' }), 1_500).message).toBe('City GIS server dropped the connection after 1.5 s (ECONNRESET)')
    expect(describeFailure(failed({ code: 'CERT_HAS_EXPIRED' }), 30).message).toBe('City GIS server TLS error (CERT_HAS_EXPIRED)')
  })

  it('looks inside the per-address errors when every address failed', () => {
    const all = failed({ errors: [{ code: 'ETIMEDOUT' }, { code: 'ETIMEDOUT' }] })
    expect(describeFailure(all, 9_000)).toEqual({ status: 504, message: 'City GIS server timed out: could not connect after 9.0 s (ETIMEDOUT)' })
  })

  it('falls back to the error text for anything else', () => {
    expect(describeFailure(new Error('boom'), 5).message).toBe('City GIS server unreachable: boom (unknown)')
  })
})
