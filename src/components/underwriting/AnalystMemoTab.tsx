import { useEffect, useState } from 'react'
import { fmt } from '../../lib/format'
import { isImportedDealId } from '../../lib/rentRollImport'
import { changesText, memoAssumptionSet, sameEdits, withoutMarker } from '../../lib/underwriting/assumptionSets'
import type { AssumptionEdits } from '../../lib/underwriting/edits'
import { loadAnalystMemo, memoDate, withoutDisclaimer } from '../../services/analystMemos'
import { Chip } from '../ui/Card'
import Markdown from '../ui/Markdown'

type MemoState = { id: string; status: 'ok'; markdown: string } | { id: string; status: 'none' | 'error' }

/**
 * The /underwriting-analyst memo for this property. The memo records the
 * assumption set it was written at; a warning shows only when the assumptions
 * applied now (`edits`, described by `applied`) are different.
 */
export default function AnalystMemoTab({ propertyId, edits, applied }: { propertyId: string; edits: AssumptionEdits; applied: string }) {
  const [memo, setMemo] = useState<MemoState | null>(null)

  useEffect(() => {
    let live = true
    loadAnalystMemo(propertyId).then(
      (markdown) => live && setMemo(markdown === null ? { id: propertyId, status: 'none' } : { id: propertyId, status: 'ok', markdown }),
      () => live && setMemo({ id: propertyId, status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [propertyId])

  if (memo?.id !== propertyId) return <p className="text-xs text-slate-500">Loading memo…</p>
  if (memo.status !== 'ok') {
    if (memo.status === 'error') return <p className="text-xs text-amber-300">The analyst memo could not be loaded.</p>
    if (isImportedDealId(propertyId)) {
      return (
        <p className="text-xs leading-snug text-slate-400">
          Memos for imported deals stay private and are not shown in the app. To write one, save the rent roll in{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">private-deals/</code>, run{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">npm run import -- &lt;file&gt;</code>, then{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">/underwriting-analyst {propertyId}</code> in Claude
          Code. The memo is written to{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">private-deals/{propertyId}/memo.md</code>.
        </p>
      )
    }
    return (
      <p className="text-xs text-slate-400">
        No analyst memo yet. Run{' '}
        <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-slate-200">/underwriting-analyst {propertyId}</code> in
        Claude Code.
      </p>
    )
  }

  const date = memoDate(memo.markdown)
  const written = memoAssumptionSet(memo.markdown)
  const writtenAt = `${written.name} (${changesText(Object.keys(written.edits).length)})`
  return (
    <article className="max-w-4xl">
      <header className="mb-4 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wide">
            <Chip tone="sky">AI analyst</Chip>
          </span>
          <span className="text-[11px] text-slate-300">
            Written by Claude Code from AVIANCRE engine outputs{date && `, ${fmt.date(date)}`}
          </span>
        </div>
        <p className="text-[10px] text-slate-500">All figures from the engine at assumption set {writtenAt}.</p>
      </header>
      {!sameEdits(written.edits, edits) && (
        <p role="note" className="mb-4 rounded-md bg-amber-500/10 p-3 text-xs leading-snug text-amber-300">
          This memo was written at assumption set {writtenAt}. The assumptions applied now ({applied}) are different, so
          numbers in the other tabs may differ from the memo.
        </p>
      )}
      <Markdown source={withoutDisclaimer(withoutMarker(memo.markdown))} />
    </article>
  )
}
