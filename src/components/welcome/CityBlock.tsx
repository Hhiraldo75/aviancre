import { BACK_FACES, FRONT_FACES, type Face } from './cityBlockShapes'

/** Window grid: 4 columns × 4 rows per tile; these [column, row] windows are lit. */
const LIT = new Set(['0,1', '1,3', '2,0', '2,3', '3,2'])
const COLUMNS = [2.6, 14.03, 25.46, 36.89]
const ROWS = [3.6, 19.44, 35.28, 51.12]

/** Lit-window pattern for a left (`skewY(30)`) or right (`skewY(-30)`) wall. */
function WindowPattern({ id, skew }: { id: string; skew: number }) {
  return (
    <pattern id={id} width="45.73" height="63.36" patternUnits="userSpaceOnUse" patternTransform={`skewY(${skew})`}>
      {COLUMNS.flatMap((x, c) =>
        ROWS.map((y, r) => {
          const lit = LIT.has(`${c},${r}`)
          return (
            <rect
              key={`${c},${r}`}
              x={x}
              y={y}
              width="6.23"
              height="8.64"
              fill={lit ? '#DCE8FF' : '#8FA3BF'}
              opacity={lit ? 0.55 : 0.16}
            />
          )
        }),
      )}
    </pattern>
  )
}

/** Faces reference the window patterns as `url(#wL)` / `url(#wR)`; this maps them to the page-unique ids. */
const faces = (list: Face[], ids: { wL: string; wR: string }) =>
  list.map(([points, fill], i) => (
    <polygon key={i} points={points} fill={fill === 'url(#wL)' ? `url(#${ids.wL})` : fill === 'url(#wR)' ? `url(#${ids.wR})` : fill} />
  ))

/**
 * Isometric city block: grey context buildings, sample properties colored by
 * occupancy (green, amber, red) and the selected tower in blue, with a
 * blinking antenna light and a leader line to its card.
 */
export default function CityBlock() {
  const ids = { wL: 'welcome-windows-left', wR: 'welcome-windows-right' }
  return (
    <svg
      viewBox="-30 30 630 510"
      className="block h-auto w-full"
      role="img"
      aria-label="Isometric city block of buildings with lit windows and rooftop details: grey context buildings, sample properties colored green, amber and red by occupancy, and a tall stepped tower selected in blue"
    >
      <defs>
        <WindowPattern id={ids.wL} skew={30} />
        <WindowPattern id={ids.wR} skew={-30} />
      </defs>
      {faces(BACK_FACES, ids)}
      <line x1="330.0" y1="99.3" x2="330.0" y2="66.3" stroke="#9CC0FF" strokeWidth="1.5" />
      <circle cx="330.0" cy="66.3" r="2" fill="#E0614F" className="motion-safe:animate-twinkle" style={{ animationDelay: '2.3s' }} />
      {faces(FRONT_FACES, ids)}
      <line x1="307.1" y1="99.3" x2="226" y2="99.3" stroke="#5B95FF" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="307.1" cy="99.3" r="3.5" fill="#5B95FF" />
    </svg>
  )
}
