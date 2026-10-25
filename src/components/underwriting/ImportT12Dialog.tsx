import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Property, T12Category, T12Line } from '../../types'
import { fmt } from '../../lib/format'
import { todayISO } from '../../lib/metrics'
import { readRentRollFile, RENT_ROLL_EXTENSIONS } from '../../lib/rentRollFile'
import type { Cell } from '../../lib/rentRollCells'
import { categoryLabel, lineTotal, T12_CATEGORIES } from '../../lib/t12'
import {
  readT12,
  statementFrom,
  T12_COLUMN_LABELS,
  T12_FORMAT_LABELS,
  t12ReadyToLoad,
  type T12ColumnKey,
  type T12Options,
} from '../../lib/t12Read'
import { useAppStore } from '../../store/useAppStore'

type FileState = { status: 'reading' } | { status: 'unreadable'; message: string } | { status: 'read'; grid: Cell[][] }

const PROVENANCE: Record<string, { label: string; className: string }> = {
  detected: { label: 'detected', className: 'bg-emerald-500/15 text-emerald-300' },
  section: { label: 'from section', className: 'bg-sky-500/15 text-sky-300' },
  user: { label: 'you', className: 'bg-slate-500/20 text-slate-200' },
}

/** Spreadsheet column letters: 0 → A, 26 → AA. */
function columnLetter(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/**
 * "Load T-12": reads a CSV or .xlsx operating statement in the browser, shows
 * the detected layout, the column mapping, a category per line (recoverable
 * per line for commercial) and the totals check against the file's own
 * totals, and loads it only when nothing blocks. Nothing is uploaded; the
 * store keeps the T-12 in local storage, apart from the deal.
 */
export default function ImportT12Dialog({ property: p, file, onClose }: { property: Property; file: File; onClose: () => void }) {
  const loadT12 = useAppStore((s) => s.loadT12)
  const [state, setState] = useState<FileState>({ status: 'reading' })
  const kind = p.rentRoll.kind
  const [options, setOptionsRaw] = useState<T12Options>({ kind })
  const [mismatchOK, setMismatchOK] = useState(false)
  const setOptions = (update: (o: T12Options) => T12Options) => {
    setOptionsRaw(update)
    setMismatchOK(false)
  }

  useEffect(() => {
    let live = true
    file
      .arrayBuffer()
      .then((buf) => readRentRollFile(file.name, new Uint8Array(buf), 'T-12'))
      .then((grid) => live && setState({ status: 'read', grid }))
      .catch((err) => live && setState({ status: 'unreadable', message: err instanceof Error ? err.message : 'Could not read the file' }))
    return () => {
      live = false
    }
  }, [file])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const r = useMemo(() => (state.status === 'read' ? readT12(state.grid, options) : null), [state, options])
  const ready = r !== null && t12ReadyToLoad(r, mismatchOK)
  const mismatches = r?.totals.filter((t) => t.match === false) ?? []

  const load = () => {
    if (!r || !ready) return
    const saved = loadT12(p.id, statementFrom(r, { fileName: file.name, importedAt: todayISO() }))
    if (!saved) window.alert('This browser would not save the T-12 (storage is blocked or full). It is loaded until you reload the page.')
    onClose()
  }

  const setColumn = (k: T12ColumnKey, column: number | null) => setOptions((o) => ({ ...o, columns: { ...o.columns, [k]: column } }))
  const setCategory = (row: number, c: T12Category) => setOptions((o) => ({ ...o, categories: { ...o.categories, [row]: c } }))
  const setRecoverable = (row: number, v: boolean) => setOptions((o) => ({ ...o, recoverable: { ...o.recoverable, [row]: v } }))
  const input = 'w-full rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-200'

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-label="Load T-12"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
      >
        <header className="border-b border-slate-700 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Load T-12 · {p.name}</div>
          <h2 className="truncate text-base font-semibold">{r?.name || file.name}</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            {file.name} · read in this browser only; nothing is uploaded. The T-12 is saved in this browser, apart from the rent roll, until you remove it.
          </p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {state.status === 'reading' && <p className="text-slate-400">Reading…</p>}
          {state.status === 'unreadable' && <p className="rounded-md bg-red-500/10 p-3 text-red-300">{state.message}</p>}

          {r && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-blue-500/15 px-2 py-0.5 font-semibold text-blue-300">{T12_FORMAT_LABELS[r.format]}</span>
                {r.headerRow !== null && <span className="text-slate-400">month header on row {r.headerRow}</span>}
                {r.periodStart && <span className="text-slate-400">· first month {fmt.monthYear(r.periodStart)}</span>}
                {r.isSample && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300">Fictional sample data</span>}
              </div>

              <Notes title={`${r.blockers.length} to fix before loading`} items={r.blockers} tone="error" />

              {r.columns.length > 0 && (
                <Section title="Columns" hint="Change any column picked. The 12 months are read from the first month on.">
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {(Object.keys(T12_COLUMN_LABELS) as T12ColumnKey[]).map((k) => (
                      <label key={k} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-slate-300">{T12_COLUMN_LABELS[k]}</span>
                        <select className={input} value={r.mapping[k].column ?? ''} onChange={(e) => setColumn(k, e.target.value === '' ? null : Number(e.target.value))}>
                          <option value="">— not in file —</option>
                          {r.columns.map((label, i) => (
                            <option key={i} value={i}>
                              {columnLetter(i)} · {label || '(no header)'}
                            </option>
                          ))}
                        </select>
                        <Chip provenance={r.mapping[k].provenance} />
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-slate-300">Period starts</span>
                      <input
                        type="month"
                        className={input}
                        value={(options.periodStart ?? r.periodStart ?? '').slice(0, 7)}
                        onChange={(e) => setOptions((o) => ({ ...o, periodStart: e.target.value ? `${e.target.value}-01` : undefined }))}
                      />
                      <Chip provenance={options.periodStart ? 'user' : r.periodStart ? 'detected' : null} />
                    </label>
                  </div>
                </Section>
              )}

              {r.totals.length > 0 && (
                <Section title="Totals check" hint="The lines as read against the file’s own Total income, Total operating expenses and NOI rows.">
                  <table className="w-full tabular-nums">
                    <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-1 text-left font-normal">Total</th>
                        <th className="py-1 text-right font-normal">Lines</th>
                        <th className="py-1 text-right font-normal">File</th>
                        <th className="py-1 pl-3 text-left font-normal">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.totals.map((t) => (
                        <tr key={t.label} className="border-t border-slate-800">
                          <td className="py-1 text-slate-300">{t.label}</td>
                          <td className="py-1 text-right">{fmt.usd(t.mapped)}</td>
                          <td className="py-1 text-right text-slate-400">{t.file === null ? '—' : fmt.usd(t.file)}</td>
                          <td className="py-1 pl-3">
                            {t.match === null ? (
                              <span className="text-slate-500">not in file</span>
                            ) : t.match ? (
                              <span className="font-semibold text-emerald-300">✓ match</span>
                            ) : (
                              <span className="font-semibold text-red-300">✗ mismatch</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {mismatches.length > 0 && (
                    <label className="mt-2 flex items-start gap-2 rounded-md bg-red-500/10 p-2 text-red-200">
                      <input type="checkbox" checked={mismatchOK} onChange={(e) => setMismatchOK(e.target.checked)} className="mt-0.5" />
                      <span>
                        {mismatches.length} total{mismatches.length === 1 ? '' : 's'} don’t match the file. Load anyway: I’ve checked the mismatch.
                      </span>
                    </label>
                  )}
                </Section>
              )}

              <Notes title={`${r.flags.length} worth checking`} items={r.flags} tone="warning" />

              {r.lines.length > 0 && (
                <Section
                  title={`Lines (${r.lines.filter((l) => !l.isSubtotal).length} + ${r.lines.filter((l) => l.isSubtotal).length} subtotals)`}
                  hint={
                    'Map each line. Operating expense categories become Year-1 expense lines (grown at expense growth); other income replaces the model’s; ' +
                    'rental income, vacancy and recoveries are for comparison (revenue comes from the rent roll); the management fee is compared with the model’s % of EGI; ' +
                    'capex is listed below NOI.' +
                    (kind === 'commercial' ? ' Recoverable lines feed tenant recoveries.' : '')
                  }
                >
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full tabular-nums text-[11px]">
                      <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-1 py-1 text-left font-normal">Row</th>
                          <th className="px-1 py-1 text-left font-normal">Line</th>
                          <th className="px-1 py-1 text-right font-normal">T-12</th>
                          <th className="px-1 py-1 text-left font-normal">Category</th>
                          {kind === 'commercial' && <th className="px-1 py-1 text-center font-normal">Recov.</th>}
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {r.lines.map((l) => (
                          <tr key={l.row} className={`border-t border-slate-800 ${l.isSubtotal ? 'text-slate-500' : ''}`}>
                            <td className="px-1 py-0.5 text-slate-500">{l.row}</td>
                            <td className="max-w-64 truncate px-1 py-0.5" title={[l.code, l.group, l.label].filter(Boolean).join(' · ')}>
                              {l.code && <span className="mr-1 font-mono text-[10px] text-slate-500">{l.code}</span>}
                              {l.isSubtotal ? <em>{l.label}</em> : l.label}
                              <span className="ml-1 text-[10px] text-slate-500">{l.side === 'income' ? 'income' : l.side === 'expense' ? 'expense' : 'below NOI'}</span>
                            </td>
                            <td className="px-1 py-0.5 text-right">{fmt.accounting(lineTotal(l))}</td>
                            <td className="px-1 py-0.5">
                              <select className={`${input} py-0.5`} value={l.category} onChange={(e) => setCategory(l.row, e.target.value as T12Category)}>
                                {T12_CATEGORIES.map((c) => (
                                  <option key={c.key} value={c.key}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {kind === 'commercial' && (
                              <td className="px-1 py-0.5 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`${l.label} recoverable`}
                                  checked={l.recoverable}
                                  disabled={l.category === 'not-used' || l.category === 'capex' || l.side === 'income'}
                                  onChange={(e) => setRecoverable(l.row, e.target.checked)}
                                />
                              </td>
                            )}
                            <td className="px-1 py-0.5">
                              <Chip provenance={l.provenance} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <CategoryTotals lines={r.lines} />
                </Section>
              )}
            </>
          )}

          <p className="text-[10px] leading-snug text-slate-500">
            One row per line item, one column per month (12 consecutive months), an optional Total column; {RENT_ROLL_EXTENSIONS.join(' or ')}. Yardi and AppFolio
            12-month statements and plain tables are recognized. T-12 values are marked ACT; the management fee stays the model’s % of EGI.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-700 p-3">
          <button type="button" onClick={onClose} className="rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={load}
            disabled={!ready}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Load T-12
          </button>
        </footer>
      </section>
    </div>
  )
}

/** Totals per category as mapped, so a remapping shows its effect right away. */
function CategoryTotals({ lines }: { lines: T12Line[] }) {
  const totals = new Map<T12Category, number>()
  for (const l of lines) if (l.category !== 'not-used') totals.set(l.category, (totals.get(l.category) ?? 0) + lineTotal(l))
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
      {T12_CATEGORIES.filter((c) => totals.has(c.key)).map((c) => (
        <span key={c.key}>
          {categoryLabel(c.key)} <span className="tabular-nums text-slate-200">{fmt.accounting(totals.get(c.key)!)}</span>
        </span>
      ))}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <h3 className="font-semibold text-slate-200">{title}</h3>
      {hint && <p className="mb-2 text-[11px] text-slate-500">{hint}</p>}
      {children}
    </section>
  )
}

function Chip({ provenance }: { provenance: string | null }) {
  if (!provenance) return <span className="w-20 shrink-0" />
  const p = PROVENANCE[provenance] ?? { label: provenance, className: 'bg-slate-500/20 text-slate-200' }
  return <span className={`w-20 shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-center text-[10px] ${p.className}`}>{p.label}</span>
}

function Notes({ title, items, tone }: { title: string; items: string[]; tone: 'error' | 'warning' }) {
  if (!items.length) return null
  const color = tone === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
  return (
    <div className={`rounded-md p-3 ${color}`}>
      <h3 className="mb-1.5 font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((m, i) => (
          <li key={i} className="leading-snug">
            {m}
          </li>
        ))}
      </ul>
    </div>
  )
}
