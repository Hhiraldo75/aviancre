const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** Wraps a formatted negative number in parentheses; "-0.0" counts as zero. */
const percent = (s: string) => (s.startsWith('-') && Number(s) !== 0 ? `(${s.slice(1)}%)` : `${s.replace(/^-/, '')}%`)

export const fmt = {
  usd: (n: number) => usd0.format(n),
  usdCents: (n: number) => usd2.format(n),
  /** Statement style: 1,234; negatives in parentheses; a dash for zero. */
  accounting: (n: number) => (Math.round(n) === 0 ? '–' : n < 0 ? `(${int.format(-n)})` : int.format(n)),
  usdCompact: (n: number) => '$' + compact.format(n),
  /** $4.15M from $1M up, full dollars with commas below that. */
  money: (n: number) => (Math.abs(n) >= 1e6 ? `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1e6).toFixed(2)}M` : usd0.format(n)),
  compact: (n: number) => compact.format(n),
  rentPerSF: (n: number) => `${usd2.format(n)}/SF`,
  rentPerUnit: (n: number) => `${usd0.format(n)}/unit/mo`,
  sf: (n: number) => `${int.format(n)} SF`,
  int: (n: number) => int.format(n),
  /** 6.5%; negatives in parentheses: (2.1%). */
  pct: (n: number, digits = 1) => percent((n * 100).toFixed(digits)),
  /** Percent with trailing zeros dropped: 1.5%, 6.5%, 7.25%, (2%). */
  pctShort: (n: number) => percent(String(Number((n * 100).toFixed(2)))),
  /** +31.5% or (12.0%). */
  signedPct: (n: number, digits = 1) => {
    const s = (n * 100).toFixed(digits)
    return s.startsWith('-') ? percent(s) : `+${s}%`
  },
  years: (n: number) => `${n.toFixed(1)} yrs`,
  multiple: (x: number) => `${x.toFixed(2)}x`,
  monthYear: (iso: string) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  date: (iso: string) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  label: (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
}

/** A file- and id-safe name: "My case (v2)" → "my-case-v2". Empty when nothing is left. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
