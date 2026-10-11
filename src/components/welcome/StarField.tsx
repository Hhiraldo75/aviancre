import { STARS } from './cityBlockShapes'

/** Night sky behind the hero; some stars twinkle (not with reduced motion). */
export default function StarField() {
  return (
    <svg
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {STARS.map(([cx, cy, r, fill, opacity, delay]) => (
        <circle
          key={`${cx},${cy}`}
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          opacity={opacity}
          className={delay === null ? undefined : 'motion-safe:animate-twinkle'}
          style={delay ? { animationDelay: `${delay}s` } : undefined}
        />
      ))}
    </svg>
  )
}
