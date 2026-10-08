const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

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
  pct: (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  signedPct: (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(digits)}%`,
  years: (n: number) => `${n.toFixed(1)} yrs`,
  multiple: (x: number) => `${x.toFixed(2)}x`,
  monthYear: (iso: string) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  label: (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
}
