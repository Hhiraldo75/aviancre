import type { LngLatLike } from 'maplibre-gl'

export const MAP_CONFIG = {
  styleUrl: 'https://tiles.openfreemap.org/styles/positron', // clean, light basemap
  center: [-71.4180, 41.8230] as LngLatLike,                 // Downtown Providence
  zoom: 14.2,
  pitch: 55,
  bearing: -20,
  maxPitch: 85,
} as const

export const LAYER_IDS = {
  contextBuildings: 'osm-buildings-3d',
  properties: 'sample-properties-3d',
} as const

export const SOURCE_IDS = {
  properties: 'sample-properties',
} as const
