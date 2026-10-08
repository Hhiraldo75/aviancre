const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export const fmt = {
  usd: (n: number) => usd0.format(n),
  usdCompact: (n: number) => '$' + compact.format(n),
  usdMillions: (n: number) => `${n < 0 ? '−' : ''}$${(Math.abs(n) / 1e6).toFixed(2)}M`,
  compact: (n: number) => compact.format(n),
  rentPerSF: (n: number) => `${usd2.format(n)}/SF`,
  rentPerUnit: (n: number) => `${usd0.format(n)}/unit/mo`,
  sf: (n: number) => `${int.format(n)} SF`,
  int: (n: number) => int.format(n),
  pct: (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  signedPct: (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(digits)}%`,
  years: (n: number) => `${n.toFixed(1)} yrs`,
  monthYear: (iso: string) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  label: (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
}
