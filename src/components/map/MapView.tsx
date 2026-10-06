import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LAYER_IDS, MAP_CONFIG, SOURCE_IDS } from '../../config/map'
import { propertiesToGeoJSON } from '../../lib/geo'
import { fmt } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import MapLegend from './MapLegend'

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const prevSelectedRef = useRef<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const properties = useAppStore((s) => s.properties)
  const asOf = useAppStore((s) => s.asOf)
  const selectedId = useAppStore((s) => s.selectedId)

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

      setLoaded(true)
    })

    map.on('click', LAYER_IDS.properties, (e) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') useAppStore.getState().select(id)
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <MapLegend />
    </div>
  )
}
