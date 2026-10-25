import { useRef, useState } from 'react'
import type { Property } from '../../types'
import { todayISO } from '../../lib/metrics'
import {
  appliedSetLabel,
  assumptionSetFile,
  changesText,
  DEFAULTS_SET,
  isModified,
  parseAssumptionSetFile,
  sameEdits,
  setFileName,
  setNameError,
  type SavedAssumptionSet,
} from '../../lib/underwriting/assumptionSets'
import type { AssumptionEdits } from '../../lib/underwriting/edits'
import { useActiveSetName, useAppStore, useAssumptionSets } from '../../store/useAppStore'
import { downloadFile } from '../ui/download'
import AssumptionNotice from './AssumptionNotice'

const BUTTON =
  'rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * Named assumption sets for one property: switch, save the current edits under
 * a name, delete, and export or import a set as a small JSON file. Sets stay in
 * this browser; nothing is uploaded.
 */
export default function AssumptionSetBar({ property: p, asOf, edits }: { property: Property; asOf: string; edits: AssumptionEdits }) {
  const sets = useAssumptionSets(p.id)
  const active = useActiveSetName(p.id)
  const save = useAppStore((s) => s.saveAssumptionSet)
  const apply = useAppStore((s) => s.applyAssumptionSet)
  const remove = useAppStore((s) => s.deleteAssumptionSet)
  const [naming, setNaming] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const modified = isModified(active, sets, edits)
  const saved = sets.find((x) => x.name === active)
  const changeCount = Object.keys(edits).length
  /** Asks before throwing away edits that aren't in any set. */
  const okToLeave = () => !modified || window.confirm(`Discard ${appliedSetLabel(active, sets, edits)}?`)

  const switchTo = (name: string) => {
    if (name === active && !modified) return
    if (!okToLeave()) return
    setProblems([])
    apply(p.id, name)
  }

  const store = (set: SavedAssumptionSet) => {
    const existing = sets.find((x) => x.name === set.name)
    if (existing && !sameEdits(existing.edits, set.edits) && !window.confirm(`Replace the saved set "${set.name}"?`)) return false
    save(p.id, set)
    return true
  }

  const commitName = () => {
    const name = (naming ?? '').trim()
    const error = setNameError(name)
    if (error) return setProblems([error])
    if (store({ name, savedAt: todayISO(), edits })) {
      setNaming(null)
      setProblems([])
    }
  }

  const importFile = async (file: File) => {
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      return setProblems([`${file.name} is not valid JSON.`])
    }
    const result = parseAssumptionSetFile(json, p, asOf)
    if (!result.set) return setProblems(result.errors.map((e) => `${file.name}: ${e}`))
    if (!okToLeave()) return
    if (store(result.set)) setProblems((result.notices ?? []).map((n) => `${file.name}: ${n}`))
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-slate-400">
          Assumption set
          <select
            value={active}
            onChange={(e) => switchTo(e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-100"
          >
            <option value={DEFAULTS_SET}>{DEFAULTS_SET}</option>
            {sets.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <span className={`text-[11px] ${modified ? 'text-amber-300' : 'text-slate-500'}`}>
          {modified && `${active === DEFAULTS_SET ? 'Unsaved changes' : 'Edited since saved'} · `}
          {changesText(changeCount)}
          {saved && !modified && ` · saved ${saved.savedAt}`}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className={BUTTON} onClick={() => (setNaming(active === DEFAULTS_SET ? '' : active), setProblems([]))}>
            Save as…
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={active === DEFAULTS_SET || !saved}
            onClick={() => window.confirm(`Delete the set "${active}"? Your current values stay applied.`) && remove(p.id, active)}
          >
            Delete set
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={!saved}
            title={modified ? 'Exports the saved set, without your unsaved changes' : 'Download this set as a JSON file'}
            onClick={() => saved && downloadFile(setFileName(p.id, saved.name), JSON.stringify(assumptionSetFile(p.id, saved), null, 2) + '\n', 'application/json')}
          >
            Export
          </button>
          <button type="button" className={BUTTON} onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </div>
      </div>

      {naming !== null && (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            commitName()
          }}
        >
          <input
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            placeholder="Set name, e.g. My case"
            maxLength={80}
            aria-label="Assumption set name"
            className="w-56 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500">
            Save {changeCount} change{changeCount === 1 ? '' : 's'}
          </button>
          <button type="button" className={BUTTON} onClick={() => (setNaming(null), setProblems([]))}>
            Cancel
          </button>
        </form>
      )}

      <AssumptionNotice propertyId={p.id} />

      {problems.length > 0 && (
        <ul role="alert" className="mt-2 space-y-0.5 rounded-md bg-red-500/10 p-2 text-[11px] leading-snug text-red-300">
          {problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Sets are kept in this browser{p.importedFrom ? ' with this deal and removed with it' : ''}; nothing is uploaded. Run an exported set with{' '}
        <code className="text-slate-400">npm run underwrite -- {p.id} --assumptions &lt;file&gt;</code>
        {p.importedFrom && (
          <>
            ; keep the file in <code className="text-slate-400">private-deals/{p.id}/</code>
          </>
        )}
        .
      </p>
    </div>
  )
}
