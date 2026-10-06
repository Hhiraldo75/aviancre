import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LAYER_IDS, MAP_CONFIG, SOURCE_IDS } from '../../config/map'
import { propertiesToGeoJSON } from '../../lib/geo'
import { fmt } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import type { ParcelLookup } from '../../types'
import MapLegend from './MapLegend'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

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
  const [loaded, setLoaded] = useState(false)

  const properties = useAppStore((s) => s.properties)
  const asOf = useAppStore((s) => s.asOf)
  const selectedId = useAppStore((s) => s.selectedId)
  const parcel = useAppStore((s) => s.parcel)

  const geojson = useMemo(() => propertiesToGeoJSON(properties, asOf), [properties, asOf])
  // Read the latest data inside map callbacks without re-creating the map.
  const geojsonRef = useRef(geojson)
  geojsonRef.current = geojson

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

      // Sample properties, colored by occupancy. promoteId lets us use feature-state for selection.
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

    // Sample building → its dashboard. Anywhere else → look up the real public parcel there.
    map.on('click', (e) => {
      const hit = map.getLayer(LAYER_IDS.properties)
        ? map.queryRenderedFeatures(e.point, { layers: [LAYER_IDS.properties] })[0]
        : undefined
      const id = hit?.properties?.id
      if (typeof id === 'string') useAppStore.getState().select(id)
      else void useAppStore.getState().lookupParcel(e.lngLat.lng, e.lngLat.lat)
    })

    map.on('mousemove', LAYER_IDS.properties, (e) => {
      const props = e.features?.[0]?.properties
      if (!props) return
      map.getCanvas().style.cursor = 'pointer'
      // Build DOM nodes instead of an HTML string, so imported tenant/property names can't inject markup.
      const el = document.createElement('div')
      el.style.cssText = 'font:12px system-ui;color:#0f172a'
      const title = document.createElement('strong')
      title.textContent = String(props.name)
      el.append(title, document.createElement('br'), `${fmt.pct(Number(props.occupancy))} leased`)
      popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map)
    })

    map.on('mouseleave', LAYER_IDS.properties, () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    })

    return () => {
      popup.remove()
      map.remove() // StrictMode mounts twice in dev
      mapRef.current = null
      setLoaded(false)
    }
  }, [])

  // 2. Push new data when properties or the analysis date change.
  useEffect(() => {
    if (!loaded) return
    const source = mapRef.current?.getSource(SOURCE_IDS.properties) as GeoJSONSource | undefined
    source?.setData(geojson)
  }, [geojson, loaded])

  // 3. Highlight and fly to the selected property.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    const prev = prevSelectedRef.current
    if (prev) map.setFeatureState({ source: SOURCE_IDS.properties, id: prev }, { selected: false })

    if (selectedId) {
      map.setFeatureState({ source: SOURCE_IDS.properties, id: selectedId }, { selected: true })
      const p = properties.find((x) => x.id === selectedId)
      if (p) map.flyTo({ center: [p.location.lng, p.location.lat], zoom: 16.3, pitch: 60, duration: 1200 })
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <MapLegend />
    </div>
  )
}
