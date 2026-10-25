import type { MultiPolygon, Polygon, Position } from 'geojson'

/** Metres per degree of latitude. */
const M_PER_DEG = 111_320

/** Douglas–Peucker on a closed ring, in metres at the ring's latitude; keeps at least a triangle. */
export function simplifyRing(ring: Position[], toleranceM: number): Position[] {
  if (ring.length <= 4) return ring
  const kx = M_PER_DEG * Math.cos((ring[0][1] * Math.PI) / 180)
  const pts = ring.map(([x, y]) => [x * kx, y * M_PER_DEG])
  const keep = new Array<boolean>(ring.length).fill(false)
  keep[0] = keep[ring.length - 1] = true

  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let worstD = 0
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(pts[i], pts[a], pts[b])
      if (d > worstD) [worst, worstD] = [i, d]
    }
    if (worst >= 0 && worstD > toleranceM) {
      keep[worst] = true
      stack.push([a, worst], [worst, b])
    }
  }
  const out = ring.filter((_, i) => keep[i])
  return out.length >= 4 ? out : ring
}

function distanceToSegment([px, py]: number[], [ax, ay]: number[], [bx, by]: number[]): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const round6 = (p: Position) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]

/** A lighter outline for the map: simplified to `toleranceM` and rounded to 6 decimals (~0.1 m). */
export function simplifyGeometry<G extends Polygon | MultiPolygon>(geometry: G, toleranceM = 0.5): G {
  const ring = (r: Position[]) => simplifyRing(r, toleranceM).map(round6)
  return (
    geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
      : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map(ring)) }
  ) as G
}
