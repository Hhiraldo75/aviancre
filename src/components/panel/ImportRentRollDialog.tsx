import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AssetType, BuildingClass, SubmarketId } from '../../types'
import { SUBMARKETS } from '../../data/submarkets'
import { fmt } from '../../lib/format'
import { readRentRollFile, RENT_ROLL_EXTENSIONS } from '../../lib/rentRollFile'
import { BUILDING_CLASSES, IMPORT_ASSET_TYPES, parseRentRoll, type Cell, type DealDetails, type ImportIssue } from '../../lib/rentRollImport'
import { todayISO } from '../../lib/metrics'
import { useAppStore } from '../../store/useAppStore'

type FileState = { status: 'reading' } | { status: 'unreadable'; message: string } | { status: 'read'; grid: Cell[][] }

/**
 * "Import rent roll": reads a CSV or .xlsx in the browser, shows every problem
 * with its row number, and loads the deal only when there are no errors.
 * Nothing is uploaded; the store keeps the deal in local storage.
 */
export default function ImportRentRollDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const asOf = useAppStore((s) => s.asOf)
  const importDeal = useAppStore((s) => s.importDeal)
  const [state, setState] = useState<FileState>({ status: 'reading' })
  const [details, setDetails] = useState<DealDetails>({})

  useEffect(() => {
    let live = true
    file
      .arrayBuffer()
      .then((buf) => readRentRollFile(file.name, new Uint8Array(buf)))
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

  const result = useMemo(
    () => (state.status === 'read' ? parseRentRoll(state.grid, { fileName: file.name, asOf, details, importedAt: todayISO() }) : null),
    [state, file.name, asOf, details],
  )
  const errors = result?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? []
  const fileDetails = result?.fileDetails ?? {}

  const load = () => {
    if (!result?.property) return
    const saved = importDeal(result.property)
    if (!saved) window.alert('This browser would not save the deal (storage is blocked or full). It is loaded until you reload the page.')
    onClose()
  }

  const select = 'w-full rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-200'

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-label="Import rent roll"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
      >
        <header className="border-b border-slate-700 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Import rent roll</div>
          <h2 className="truncate text-base font-semibold">{result?.summary.name || file.name}</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            {file.name} · read in this browser only; nothing is uploaded. The deal is saved in this browser until you remove it.
          </p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {state.status === 'reading' && <p className="text-slate-400">Reading…</p>}
          {state.status === 'unreadable' && <p className="rounded-md bg-red-500/10 p-3 text-red-300">{state.message}</p>}

          {result && (
            <>
              <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                {result.summary.kind === 'multifamily' ? (
                  <>
                    <Count label="Units" value={`${fmt.int(result.summary.units)} · ${fmt.int(result.summary.occupiedUnits)} occupied`} />
                    <Count label="Floor plans" value={fmt.int(result.summary.floorPlans)} />
                  </>
                ) : (
                  <>
                    <Count label="Leases" value={`${result.summary.leases} · ${fmt.sf(result.summary.leasedSF)}`} />
                    <Count label="Vacant suites" value={`${result.summary.vacancies} · ${fmt.sf(result.summary.vacantSF)}`} />
                  </>
                )}
                <Count label="Rentable" value={result.summary.rentableSF ? fmt.sf(result.summary.rentableSF) : '—'} />
              </div>

              {(!fileDetails.assetType || !fileDetails.buildingClass || !fileDetails.submarket) && (
                <div>
                  <p className="mb-2 text-slate-300">The file doesn’t say what sets the market defaults. Choose:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {!fileDetails.assetType && (
                      <Picker label="Asset type">
                        <select
                          className={select}
                          value={details.assetType ?? ''}
                          onChange={(e) => setDetails((d) => ({ ...d, assetType: (e.target.value || undefined) as AssetType | undefined }))}
                        >
                          <option value="">Choose…</option>
                          {IMPORT_ASSET_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {fmt.label(t)}
                            </option>
                          ))}
                        </select>
                      </Picker>
                    )}
                    {!fileDetails.buildingClass && (
                      <Picker label="Class">
                        <select
                          className={select}
                          value={details.buildingClass ?? ''}
                          onChange={(e) => setDetails((d) => ({ ...d, buildingClass: (e.target.value || undefined) as BuildingClass | undefined }))}
                        >
                          <option value="">Choose…</option>
                          {BUILDING_CLASSES.map((c) => (
                            <option key={c} value={c}>
                              Class {c}
                            </option>
                          ))}
                        </select>
                      </Picker>
                    )}
                    {!fileDetails.submarket && (
                      <Picker label="Submarket">
                        <select
                          className={select}
                          value={details.submarket ?? ''}
                          onChange={(e) => setDetails((d) => ({ ...d, submarket: (e.target.value || undefined) as SubmarketId | undefined }))}
                        >
                          <option value="">Choose…</option>
                          {Object.values(SUBMARKETS).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </Picker>
                    )}
                  </div>
                </div>
              )}

              <Issues title={`${errors.length} error${errors.length === 1 ? '' : 's'}: fix the file and import again`} issues={errors} tone="error" />
              <Issues title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`} issues={warnings} tone="warning" />
              {!errors.length && !warnings.length && <p className="text-emerald-300">No problems found.</p>}
            </>
          )}

          <p className="text-[10px] leading-snug text-slate-500">
            Format: the rent roll export (title, Rentable SF, Property block, Leases and Vacant suites tables), as {RENT_ROLL_EXTENSIONS.join(' or ')}.
            Rents are annual $/SF; percentages are decimals (0.03 = 3%). Apartments: a unit rent roll (Property block, then a Units
            table, one row per unit, rents $/month). Values from the file are marked ACT; market figures and assumptions stay EST.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-700 p-3">
          <button type="button" onClick={onClose} className="rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={load}
            disabled={!result?.property}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {warnings.length && result?.property ? `Load deal with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : 'Load deal'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Issues({ title, issues, tone }: { title: string; issues: ImportIssue[]; tone: 'error' | 'warning' }) {
  if (!issues.length) return null
  const color = tone === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
  return (
    <div className={`rounded-md p-3 ${color}`}>
      <h3 className="mb-1.5 font-semibold">{title}</h3>
      <ul className="space-y-1">
        {issues.map((i, n) => (
          <li key={n} className="leading-snug">
            {i.row !== undefined && <span className="font-semibold tabular-nums">Row {i.row}</span>}
            {i.row !== undefined && i.column && <span className="opacity-70"> · {i.column}</span>}
            {i.row !== undefined && ': '}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
