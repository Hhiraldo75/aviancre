import { useEffect, useMemo, useRef, useState } from 'react'
import type { Property } from '../../types'
import { fmt } from '../../lib/format'
import { fullUnderwriting, toCSV } from '../../lib/underwriting'
import { useAppStore, useAssumptionEdits } from '../../store/useAppStore'
import { Chip, Stat } from '../ui/Card'
import ImportedChip from '../ui/ImportedChip'
import AnalystMemoTab from './AnalystMemoTab'
import AssumptionsTab from './AssumptionsTab'
import ChangedChip from './ChangedChip'
import CashFlowTab from './CashFlowTab'
import RentRollTab from './RentRollTab'
import ReturnsTab from './ReturnsTab'

const TABS = ['Cash flow', 'Rent roll', 'Returns', 'Assumptions', 'Analyst memo'] as const
type Tab = (typeof TABS)[number]

function downloadCSV(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Full underwriting over the map; renders the mapped view only, no math. Assumption edits recalculate everything. */
export default function FullUnderwritingPanel({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const close = useAppStore((s) => s.closeUnderwriting)
  const setAssumption = useAppStore((s) => s.setAssumption)
  const resetAssumption = useAppStore((s) => s.resetAssumption)
  const resetAssumptions = useAppStore((s) => s.resetAssumptions)
  const edits = useAssumptionEdits(p.id)
  const view = useMemo(() => fullUnderwriting(p, asOf, edits), [p, asOf, edits])
  const [tab, setTab] = useState<Tab>('Cash flow')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <section
      role="dialog"
      aria-label={`Full underwriting: ${p.name}`}
      className="absolute inset-3 z-20 flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
    >
      <header className="border-b border-slate-700 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Full underwriting</div>
            <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
            {view.status === 'ok' && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide">
                <Chip>{fmt.label(view.header.scenario)} case</Chip>
                {view.header.isSample && <Chip tone="amber">Sample data</Chip>}
                {view.header.importedFrom && <ImportedChip from={view.header.importedFrom} />}
                <ChangedChip changes={view.header.changes} />
                {view.header.estimates && (
                  <span title={view.header.estimates.notes} className="cursor-help text-[10px] font-normal normal-case tracking-normal text-slate-400">
                    Results use estimated market assumptions (EST)
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close full underwriting"
            title="Close (Esc)"
            className="rounded px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ×
          </button>
        </div>

        {view.status === 'ok' && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
              {view.header.metrics.map((stat) => (
                <Stat key={stat.label} {...stat} />
              ))}
            </div>
            {view.header.warnings.length > 0 && (
              <details className="mt-3 text-[11px]">
                <summary className="cursor-pointer select-none font-semibold text-amber-300">
                  {view.header.warnings.length} warning{view.header.warnings.length > 1 ? 's' : ''}
                </summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-snug text-amber-300 marker:text-amber-500">
                  {view.header.warnings.map((w) => (
                    <li key={w.full}>{w.full}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </header>

      {view.status === 'unavailable' ? (
        <p className="m-4 rounded-md bg-amber-500/10 p-3 text-xs leading-snug text-amber-300">{view.reason}</p>
      ) : (
        <>
          <div role="tablist" aria-label="Underwriting sections" className="flex gap-1 border-b border-slate-700 px-4">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`uw-tab-${t}`}
                aria-selected={tab === t}
                aria-controls="uw-tabpanel"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
                  tab === t ? 'border-sky-400 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div id="uw-tabpanel" role="tabpanel" aria-labelledby={`uw-tab-${tab}`} className="flex-1 overflow-y-auto p-4">
            {tab === 'Cash flow' && (
              <CashFlowTab
                table={view.cashFlow}
                onDownload={() => downloadCSV(`${p.id}-underwriting.csv`, toCSV(view.result, p.name))}
              />
            )}
            {tab === 'Rent roll' && <RentRollTab rentRoll={view.rentRoll} />}
            {tab === 'Returns' && (
              <ReturnsTab returns={view.returns} property={p} asOf={asOf} assumptions={view.result.assumptions} />
            )}
            {tab === 'Assumptions' && (
              <AssumptionsTab
                groups={view.assumptions}
                changed={view.header.changes.length > 0}
                onSet={(key, value) => setAssumption(p.id, key, value)}
                onReset={(key) => resetAssumption(p.id, key)}
                onResetAll={() => resetAssumptions(p.id)}
              />
            )}
            {tab === 'Analyst memo' && <AnalystMemoTab propertyId={p.id} edited={view.header.changes.length > 0} />}
            {view.header.notes.length > 0 && (
              <div className="mt-6 space-y-1 border-t border-slate-700 pt-3 text-[10px] leading-snug text-slate-500">
                {view.header.notes.map((n) => (
                  <p key={n}>* {n}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
