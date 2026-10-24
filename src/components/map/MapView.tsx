import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LAYER_IDS, MAP_CONFIG, SOURCE_IDS } from '../../config/map'
import { hasActiveFilters } from '../../lib/filters'
import { approximatePinsGeoJSON, buildingOutlineIn, featureBounds, isApproximatePin, propertiesToGeoJSON } from '../../lib/geo'
import { fmt } from '../../lib/format'
import { useAppStore, usePropertyView } from '../../store/useAppStore'
import type { ParcelLookup } from '../../types'
import MapLegend from './MapLegend'
import { PIN_PIXEL_RATIO, PIN_TIP_OFFSET, pinIcon } from './pinIcon'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Placing a deal: read the OSM building from whatever tiles have loaded by now if the map never settles. */
const PLACEMENT_WAIT_MS = 6_000

/** Outline of the looked-up parcel, when the city GIS server provided one. */
function parcelGeoJSON(lookup: ParcelLookup): FeatureCollection {
  if (lookup.status !== 'loaded' || lookup.gis.status !== 'ok' || !lookup.gis.parcel.geometry) return EMPTY
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: lookup.gis.parcel.geometry }] }
}

/**
 * A dot: where the user clicked (loading / not found), or the matched tax-roll
 * location when there's no parcel outline to draw.
 */
function clickPointGeoJSON(lookup: ParcelLookup): FeatureCollection {
  if (lookup.status === 'idle') return EMPTY
  let coords: [number, number] = [lookup.lng, lookup.lat]
  let status: string = lookup.status
  if (lookup.status === 'loaded') {
    if (lookup.gis.status === 'ok' && lookup.gis.parcel.geometry) return EMPTY
    if (!lookup.record) return EMPTY
    coords = [lookup.record.lng, lookup.record.lat]
    status = 'matched'
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { status }, geometry: { type: 'Point', coordinates: coords } }],
  }
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const prevSelectedRef = useRef<string | null>(null)
  /** Set after "Zoom to results", so clearing the filters zooms back out to all buildings. */
  const zoomedToResultsRef = useRef(false)
  const [loaded, setLoaded] = useState(false)

  const properties = useAppStore((s) => s.properties)
  const asOf = useAppStore((s) => s.asOf)
  const selectedId = useAppStore((s) => s.selectedId)
  const parcel = useAppStore((s) => s.parcel)
  const { matchIds } = usePropertyView()
  const zoomRequest = useAppStore((s) => s.zoomRequest)
  const mapFocus = useAppStore((s) => s.mapFocus)
  const filtered = useAppStore((s) => hasActiveFilters(s.filters))
  const placing = useAppStore((s) => s.placing)
  const placementRequest = useAppStore((s) => s.placementRequest)

  const geojson = useMemo(() => propertiesToGeoJSON(properties, asOf, matchIds), [properties, asOf, matchIds])
  // Read the latest data inside map callbacks without re-creating the map.
  const geojsonRef = useRef(geojson)
  geojsonRef.current = geojson
  const pins = useMemo(() => approximatePinsGeoJSON(properties, asOf, matchIds), [properties, asOf, matchIds])
  const pinsRef = useRef(pins)
  pinsRef.current = pins

  // 1. Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_CONFIG.styleUrl,
      center: MAP_CONFIG.center,
      zoom: MAP_CONFIG.zoom,
      pitch: MAP_CONFIG.pitch,
      bearing: MAP_CONFIG.bearing,
      maxPitch: MAP_CONFIG.maxPitch,
      canvasContextAttributes: { antialias: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })

    map.on('load', () => {
      // Muted OpenStreetMap buildings for city context.
      map.addLayer({
        id: LAYER_IDS.contextBuildings,
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-color': '#d4d4d8',
          'fill-extrusion-opacity': 0.55,
        },
      })

      // Sample properties, colored by occupancy (faded gray when filtered out). promoteId lets us use feature-state for selection.
      map.addSource(SOURCE_IDS.properties, {
        type: 'geojson',
        data: geojsonRef.current,
        promoteId: 'id',
      })
      map.addLayer({
        id: LAYER_IDS.properties,
        type: 'fill-extrusion',
        source: SOURCE_IDS.properties,
        paint: {
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-base': 0,
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#3b82f6',
            ['get', 'color'],
          ],
          'fill-extrusion-opacity': 0.92,
        },
      })

      // Imported deals without a known location: a pin colored by occupancy, drawn over the buildings without hiding them.
      map.addImage('deal-pin', pinIcon(), { sdf: true, pixelRatio: PIN_PIXEL_RATIO })
      map.addSource(SOURCE_IDS.approxPins, { type: 'geojson', data: pinsRef.current, promoteId: 'id' })
      map.addLayer({
        id: LAYER_IDS.approxPins,
        type: 'symbol',
        source: SOURCE_IDS.approxPins,
        layout: {
          'icon-image': 'deal-pin',
          'icon-anchor': 'bottom',
          'icon-offset': [0, PIN_TIP_OFFSET],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#3b82f6', ['get', 'color']],
          'icon-halo-color': '#ffffff',
          'icon-halo-width': 2,
        },
      })

      // Looked-up public parcel: translucent footprint + outline drawn over the buildings.
      map.addSource(SOURCE_IDS.parcel, { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: LAYER_IDS.parcelFill,
        type: 'fill',
        source: SOURCE_IDS.parcel,
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: LAYER_IDS.parcelLine,
        type: 'line',
        source: SOURCE_IDS.parcel,
        paint: { 'line-color': '#2563eb', 'line-width': 3 },
      })

      map.addSource(SOURCE_IDS.clickPoint, { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: LAYER_IDS.clickPoint,
        type: 'circle',
        source: SOURCE_IDS.clickPoint,
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'status'], 'matched', '#2563eb', 'loading', '#60a5fa', '#94a3b8'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })

      setLoaded(true)
    })

    // Matching sample building → its dashboard. Anywhere else, including a
    // filtered-out sample building → look up the real public parcel there.
    // While placing a deal, every click places it, whatever is drawn there.
    const clickable = [LAYER_IDS.approxPins, LAYER_IDS.properties]
    map.on('click', (e) => {
      const { placing: placingNow, placeDeal } = useAppStore.getState()
      if (placingNow) return void placeDeal(placingNow.dealId, e.lngLat, 'click')
      const layers = clickable.filter((l) => map.getLayer(l))
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined
      const id = hit?.properties?.matches ? hit.properties.id : undefined
      if (typeof id === 'string') useAppStore.getState().select(id)
      else void useAppStore.getState().lookupParcel(e.lngLat.lng, e.lngLat.lat)
    })

    const hover = (e: maplibregl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties
      if (useAppStore.getState().placing) {
        map.getCanvas().style.cursor = 'crosshair'
        popup.remove()
        return
      }
      if (!props?.matches) {
        map.getCanvas().style.cursor = ''
        popup.remove()
        return
      }
      map.getCanvas().style.cursor = 'pointer'
      // Build DOM nodes instead of an HTML string, so imported tenant/property names can't inject markup.
      const el = document.createElement('div')
      el.style.cssText = 'font:12px system-ui;color:#0f172a'
      const title = document.createElement('strong')
      title.textContent = String(props.name)
      el.append(title, document.createElement('br'), `${fmt.pct(Number(props.occupancy))} leased`)
      if (e.features?.[0]?.layer.id === LAYER_IDS.approxPins) el.append(document.createElement('br'), 'Location approximate')
      popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map)
    }
    const leave = () => {
      map.getCanvas().style.cursor = useAppStore.getState().placing ? 'crosshair' : ''
      popup.remove()
    }
    for (const layer of clickable) {
      map.on('mousemove', layer, hover)
      map.on('mouseleave', layer, leave)
    }

    return () => {
      popup.remove()
      map.remove() // StrictMode mounts twice in dev
      mapRef.current = null
      setLoaded(false)
    }
  }, [])

  // 2. Push new data when properties, the analysis date or the filters change.
  useEffect(() => {
    if (!loaded) return
    const map = mapRef.current
    ;(map?.getSource(SOURCE_IDS.properties) as GeoJSONSource | undefined)?.setData(geojson)
    ;(map?.getSource(SOURCE_IDS.approxPins) as GeoJSONSource | undefined)?.setData(pins)
  }, [geojson, pins, loaded])

  // 3. Highlight and fly to the selected property.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    // The previous pick may have been deleted since, so clear it on both sources.
    const prev = prevSelectedRef.current
    if (prev) for (const source of [SOURCE_IDS.properties, SOURCE_IDS.approxPins]) map.setFeatureState({ source, id: prev }, { selected: false })

    const p = selectedId ? properties.find((x) => x.id === selectedId) : undefined
    if (p) {
      map.setFeatureState({ source: isApproximatePin(p) ? SOURCE_IDS.approxPins : SOURCE_IDS.properties, id: p.id }, { selected: true })
      map.flyTo({ center: [p.location.lng, p.location.lat], zoom: 16.3, pitch: 60, duration: 1200 })
    }
    prevSelectedRef.current = selectedId
  }, [selectedId, loaded, properties])

  // 4. Show the looked-up parcel outline and the click point.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    ;(map.getSource(SOURCE_IDS.parcel) as GeoJSONSource | undefined)?.setData(parcelGeoJSON(parcel))
    ;(map.getSource(SOURCE_IDS.clickPoint) as GeoJSONSource | undefined)?.setData(clickPointGeoJSON(parcel))
  }, [parcel, loaded])

  // 5. Fly to a parcel picked in the address search, keeping the current tilt and rotation.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !mapFocus) return
    map.flyTo({ center: [mapFocus.lng, mapFocus.lat], zoom: 17, pitch: map.getPitch(), bearing: map.getBearing(), duration: 1200 })
  }, [mapFocus, loaded])

  // 6. Placing a deal: crosshair cursor, then fly to the parcel found and read the OSM building on it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [placing, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !placementRequest) return
    const request = placementRequest
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      // Building features from every loaded tile; the tiles hold OSM buildings only, so nothing is fetched.
      const buildings = map.getSource('openmaptiles') ? map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }) : []
      const saved = useAppStore.getState().completePlacement(request, buildingOutlineIn(buildings, request.parcel))
      if (!saved) window.alert('This browser would not save the location (storage is blocked or full). It lasts until you reload the page.')
    }
    const settled = () => map.once('idle', finish)
    const timer = window.setTimeout(finish, PLACEMENT_WAIT_MS)
    map.once('moveend', settled)
    const [lng, lat] = request.point
    map.flyTo({ center: [lng, lat], zoom: 17, pitch: map.getPitch(), bearing: map.getBearing(), duration: 1200 })
    return () => {
      done = true
      window.clearTimeout(timer)
      map.off('moveend', settled)
      map.off('idle', finish)
    }
  }, [placementRequest, loaded])

  // 7. "Zoom to results": fit the matching buildings, keeping the current tilt and rotation.
  const fitTo = (features: Feature<Polygon | Point>[]) => {
    const map = mapRef.current
    const bounds = featureBounds(features)
    if (!map || !bounds) return false
    map.fitBounds(bounds, { padding: 80, maxZoom: 16.5, pitch: map.getPitch(), bearing: map.getBearing(), duration: 1200 })
    return true
  }

  useEffect(() => {
    if (!loaded || zoomRequest === 0) return
    const all = [...geojsonRef.current.features, ...pinsRef.current.features]
    if (fitTo(all.filter((f) => f.properties.matches))) zoomedToResultsRef.current = true
  }, [zoomRequest, loaded])

  useEffect(() => {
    if (!loaded || filtered || !zoomedToResultsRef.current) return
    zoomedToResultsRef.current = false
    fitTo([...geojsonRef.current.features, ...pinsRef.current.features])
  }, [filtered, loaded])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <MapLegend />
    </div>
  )
}
