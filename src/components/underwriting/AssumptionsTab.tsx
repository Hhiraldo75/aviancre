import { useState } from 'react'
import type { Sourced } from '../../types'
import { parseInput, sameValue } from '../../lib/underwriting/edits'
import type { AssumptionEdit, AssumptionGroup } from '../../lib/underwriting/fullView'
import { Card } from '../ui/Card'
import SourceBadge from '../ui/SourceBadge'

interface Handlers {
  /** Stores a validated value in engine units. */
  onSet: (key: string, value: number) => void
  onReset: (key: string) => void
}

/** Every assumption with its source; numeric ones are editable and results recalculate as you type. */
export default function AssumptionsTab({
  groups,
  changed,
  onResetAll,
  ...handlers
}: { groups: AssumptionGroup[]; changed: boolean; onResetAll: () => void } & Handlers) {
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          <SourceBadge data={{ source: 'estimated', sourceName: 'Estimate' }} /> = industry rule of thumb or placeholder; replace with a
          market report. <SourceBadge data={{ source: 'estimated', sourceName: 'Analyst input' }} asUser /> = your input.
        </p>
        <button
          type="button"
          onClick={onResetAll}
          disabled={!changed}
          className="shrink-0 rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Reset all to defaults
        </button>
      </div>
      {groups.map((g) => (
        <Card key={g.title} title={g.title}>
          {g.note && <p className="-mt-1 mb-2 text-[10px] leading-snug text-slate-500">{g.note}</p>}
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[34%]" />
              <col />
            </colgroup>
            <tbody>
              {g.items.map((x) => (
                <tr key={x.label} className="border-t border-slate-700/70 align-top first:border-t-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-300">
                    {x.label}
                  </th>
                  <td className="py-1.5 pr-3">
                    {x.edit ? (
                      <AssumptionInput key={x.edit.field.key} label={x.label} edit={x.edit} src={x.src!} {...handlers} />
                    ) : (
                      <div className="py-0.5 font-semibold tabular-nums">{x.value}</div>
                    )}
                  </td>
                  <td className="py-2 text-[10px] leading-snug text-slate-500">{x.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  )
}

function AssumptionInput({
  label,
  edit,
  src,
  onSet,
  onReset,
}: { label: string; edit: AssumptionEdit; src: Sourced<unknown> } & Handlers) {
  const { field } = edit
  const [draft, setDraft] = useState(edit.input)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(edit.value)

  // The value changed elsewhere (a reset, or a re-derived price): show it unless the draft already says it.
  if (!sameValue(shown, edit.value)) {
    setShown(edit.value)
    const parsed = parseInput(field, draft)
    if (!('value' in parsed) || !sameValue(parsed.value, edit.value)) {
      setDraft(edit.input)
      setError(null)
    }
  }

  const change = (text: string) => {
    setDraft(text)
    const parsed = parseInput(field, text)
    if ('error' in parsed) return setError(parsed.error)
    setError(null)
    if (sameValue(parsed.value, edit.defaultValue)) onReset(field.key)
    else if (!sameValue(parsed.value, edit.value) || !edit.edited) onSet(field.key, parsed.value)
  }
  /** Back to the default; an edited value re-syncs the draft above once the store changes. */
  const reset = () => {
    setError(null)
    if (edit.edited) onReset(field.key)
    else setDraft(edit.input)
  }
  const dirty = edit.edited || error !== null

  const errorId = `${field.key}-error`
  return (
    <div>
      <div className="flex items-center gap-1">
        {field.prefix && <span className="text-slate-500">{field.prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            // Esc reverts an edit first; with nothing to revert it closes the panel as usual.
            if (e.key === 'Escape' && dirty) {
              e.stopPropagation()
              reset()
            }
          }}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className={`w-24 rounded border bg-slate-950 px-1.5 py-0.5 text-right font-semibold tabular-nums text-slate-100 outline-none ${
            error ? 'border-amber-400' : `focus:border-sky-400 ${edit.edited ? 'border-violet-500/60' : 'border-slate-600'}`
          }`}
        />
        <span className="whitespace-nowrap text-slate-500">{field.suffix}</span>
        <SourceBadge data={src} asUser={edit.edited} />
        {dirty && (
          <button
            type="button"
            onClick={reset}
            title={`Reset to ${edit.defaultText}`}
            aria-label={`Reset ${label} to default`}
            className="ml-0.5 rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ↺
          </button>
        )}
      </div>
      {error ? (
        <div id={errorId} role="alert" className="mt-0.5 text-[10px] text-amber-300">
          {error}
        </div>
      ) : (
        edit.edited && <div className="mt-0.5 text-[10px] text-slate-500">{edit.defaultText}</div>
      )}
    </div>
  )
}
