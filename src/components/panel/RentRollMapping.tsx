import { useState, type ReactNode } from 'react'
import { fmt } from '../../lib/format'
import { todayISO } from '../../lib/metrics'
import {
  conversionCSV,
  FORMAT_LABELS,
  formatTotal,
  presetFrom,
  presetsFile,
  STATUS_CHOICES,
  totalsMismatches,
  type ChargeUse,
  type Conversion,
  type ConvertOptions,
  type FieldKey,
  type StatusChoice,
} from '../../lib/rentRollConvert'
import { useAppStore } from '../../store/useAppStore'
import { downloadFile } from '../ui/download'

const PREVIEW_ROWS = 20

const PROVENANCE: Record<string, { label: string; className: string }> = {
  detected: { label: 'detected', className: 'bg-emerald-500/15 text-emerald-300' },
  synonym: { label: 'header synonym', className: 'bg-sky-500/15 text-sky-300' },
  preset: { label: 'preset', className: 'bg-violet-500/15 text-violet-300' },
  user: { label: 'you', className: 'bg-slate-500/20 text-slate-200' },
}

const CHARGE_USES: { value: ChargeUse; label: string }[] = [
  { value: 'rent', label: 'Rent' },
  { value: 'other', label: 'Other income' },
  { value: 'excluded', label: 'Excluded' },
]

/** Spreadsheet column letters: 0 → A, 26 → AA. */
function columnLetter(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/**
 * The mapping step of the import, for a rent roll that isn't in our format:
 * what was detected, the column mapping (every dropdown can be changed), charge
 * codes and status values to classify, floor plan names, the totals check
 * against the file, and a preview of the converted rows. The dialog's
 * Continue stays off while anything blocks (`readyToLoad`), and a totals
 * mismatch needs an explicit OK.
 */
export default function RentRollMapping({
  fileName,
  conversion: c,
  options,
  setOptions,
  mismatchOK,
  setMismatchOK,
}: {
  fileName: string
  conversion: Conversion
  options: ConvertOptions
  setOptions: (update: (o: ConvertOptions) => ConvertOptions) => void
  mismatchOK: boolean
  setMismatchOK: (ok: boolean) => void
}) {
  const saveRentRollPreset = useAppStore((s) => s.saveRentRollPreset)
  const presets = useAppStore((s) => s.rentRollPresets)
  const [presetName, setPresetName] = useState(c.presetName ?? '')
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const mismatches = totalsMismatches(c)
  const convertible = c.format === 'yardi-lease-charges' || c.format === 'generic'

  const setMapping = (key: FieldKey, column: number | null) => setOptions((o) => ({ ...o, mapping: { ...o.mapping, [key]: column } }))
  const setCharge = (code: string, use: ChargeUse) => setOptions((o) => ({ ...o, chargeCodes: { ...o.chargeCodes, [code]: use } }))
  const setStatus = (value: string, choice: StatusChoice) => setOptions((o) => ({ ...o, statusValues: { ...o.statusValues, [value]: choice } }))
  const setPlanName = (key: string, name: string) => setOptions((o) => ({ ...o, planNames: { ...o.planNames, [key]: name } }))

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    saveRentRollPreset(presetFrom(c, name, todayISO()))
    setSavedAs(name)
  }
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const input = 'w-full rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-200'

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-blue-500/15 px-2 py-0.5 font-semibold text-blue-300">{FORMAT_LABELS[c.format]}</span>
        {c.headerRow !== null && <span className="text-slate-400">header on row {c.headerRow}</span>}
        {c.presetName && <span className="rounded bg-violet-500/15 px-2 py-0.5 text-violet-300">Preset: {c.presetName}</span>}
        {c.asOf && <span className="text-slate-400">· as of {fmt.date(c.asOf)}</span>}
      </div>

      {convertible && (
        <label className="block max-w-sm">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">Property name</span>
          <input
            className={input}
            value={options.name ?? c.name}
            placeholder="Property name"
            onChange={(e) => setOptions((o) => ({ ...o, name: e.target.value }))}
          />
        </label>
      )}

      <Notes title={`${c.blockers.length} to fix before loading`} items={c.blockers} tone="error" />

      {convertible && c.totals.length > 0 && (
        <Section title="Totals check" hint="The converted rent roll against the file's own totals.">
          <table className="w-full tabular-nums">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 text-left font-normal">Total</th>
                <th className="py-1 text-right font-normal">Converted</th>
                <th className="py-1 text-right font-normal">File</th>
                <th className="py-1 pl-3 text-left font-normal">Check</th>
              </tr>
            </thead>
            <tbody>
              {c.totals.map((t) => (
                <tr key={t.label} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{t.label}</td>
                  <td className="py-1 text-right">{formatTotal(t.kind, t.converted)}</td>
                  <td className="py-1 text-right text-slate-400">{t.file === null ? '—' : formatTotal(t.kind, t.file)}</td>
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

      {c.fields.length > 0 && (
        <Section title="Column mapping" hint="Change any column the converter picked. Required fields must be mapped.">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {c.fields.map((f) => (
              <label key={f.key} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-slate-300">
                  {f.label}
                  {f.required && <span className="text-red-300"> *</span>}
                </span>
                <select
                  className={input}
                  value={f.column ?? ''}
                  onChange={(e) => setMapping(f.key, e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">— not in file —</option>
                  {c.columns.map((label, i) => (
                    <option key={i} value={i}>
                      {columnLetter(i)} · {label || '(no header)'}
                    </option>
                  ))}
                </select>
                <Chip provenance={f.provenance} />
              </label>
            ))}
          </div>
        </Section>
      )}

      {c.chargeCodes.length > 0 && (
        <Section title="Charge codes" hint="Monthly totals over occupied units. Rent is in-place rent; other income is kept per unit.">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {c.chargeCodes.map((x) => (
              <label key={x.code} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate font-mono text-slate-300">{x.code}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">{fmt.usdCents(x.total)}</span>
                <select className={input} value={x.use} onChange={(e) => setCharge(x.code, e.target.value as ChargeUse)}>
                  {CHARGE_USES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <Chip provenance={x.provenance} />
              </label>
            ))}
          </div>
        </Section>
      )}

      {c.statusValues.length > 0 && (
        <Section title="Status values" hint="What each status (or resident marker) in the file means.">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {c.statusValues.map((s) => (
              <label key={s.value} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-slate-300">
                  {s.value || '(blank)'} <span className="text-slate-500">×{s.count}</span>
                </span>
                <select
                  className={`${input} ${s.choice ? '' : 'border-red-400'}`}
                  value={s.choice ?? ''}
                  onChange={(e) => setStatus(s.value, e.target.value as StatusChoice)}
                >
                  {!s.choice && <option value="">Choose…</option>}
                  {STATUS_CHOICES.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <Chip provenance={s.provenance} />
              </label>
            ))}
          </div>
        </Section>
      )}

      {c.plans.length > 0 && (
        <Section title="Floor plans" hint="One per SF + market rent. Rename them (e.g. “1 Bed”); plans given the same name are merged.">
          <table className="w-full tabular-nums">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 text-left font-normal">Name</th>
                <th className="py-1 text-right font-normal">SF</th>
                <th className="py-1 text-right font-normal">Market</th>
                <th className="py-1 text-right font-normal">Units</th>
                <th className="py-1 pl-3 text-left font-normal">Unit types in the file</th>
              </tr>
            </thead>
            <tbody>
              {c.plans.map((p) => (
                <tr key={p.key} className="border-t border-slate-800">
                  <td className="py-1 pr-2">
                    <input
                      className={`${input} max-w-40`}
                      value={options.planNames?.[p.key] ?? p.defaultName}
                      onChange={(e) => setPlanName(p.key, e.target.value)}
                    />
                  </td>
                  <td className="py-1 text-right">{p.sf === null ? '—' : fmt.int(p.sf)}</td>
                  <td className="py-1 text-right">{p.market === null ? '—' : fmt.usd(p.market)}</td>
                  <td className="py-1 text-right">{p.units}</td>
                  <td className="truncate py-1 pl-3 font-mono text-[10px] text-slate-400" title={p.codes.join(', ')}>
                    {p.codes.length > 4 ? `${p.codes.slice(0, 4).join(', ')} +${p.codes.length - 4}` : p.codes.join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Notes title={`${c.flags.length} inferred or worth checking`} items={c.flags} tone="warning" />

      {c.units.length > 0 && (
        <Section
          title={`Preview: first ${Math.min(PREVIEW_ROWS, c.units.length)} of ${fmt.int(c.units.length)} units`}
          hint="Highlighted cells were inferred, not read from the file."
        >
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap tabular-nums text-[11px]">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {['Row', 'Unit', 'Floor plan', 'SF', 'Status', 'Market', 'In-place', 'Other', 'Move-in', 'Lease end', 'Balance', 'Pre-leased', 'Future rent'].map((h) => (
                    <th key={h} className="px-1.5 py-1 text-left font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.units.slice(0, PREVIEW_ROWS).map((u) => {
                  const inferred = (k: (typeof u.inferred)[number]) => (u.inferred.includes(k) ? 'bg-amber-500/15 text-amber-200' : '')
                  return (
                    <tr key={u.sourceRow} className="border-t border-slate-800" title={u.notes.join('\n')}>
                      <td className="px-1.5 py-0.5 text-slate-500">{u.sourceRow}</td>
                      <td className="px-1.5 py-0.5">{u.unit}</td>
                      <td className="px-1.5 py-0.5">{u.plan}</td>
                      <td className="px-1.5 py-0.5">{u.sf === null ? '—' : fmt.int(u.sf)}</td>
                      <td className={`px-1.5 py-0.5 ${inferred('status')}`}>{u.occupied ? 'Occupied' : 'Vacant'}</td>
                      <td className="px-1.5 py-0.5">{u.market === null ? '—' : fmt.usd(u.market)}</td>
                      <td className="px-1.5 py-0.5">{u.occupied ? fmt.usdCents(u.inPlace) : '—'}</td>
                      <td className="px-1.5 py-0.5">{u.otherIncome ? fmt.usdCents(u.otherIncome) : '—'}</td>
                      <td className="px-1.5 py-0.5">{u.moveIn ?? ''}</td>
                      <td className={`px-1.5 py-0.5 ${inferred('leaseEnd')}`}>{u.leaseEnd ?? ''}</td>
                      <td className="px-1.5 py-0.5">{u.balance ? fmt.usdCents(u.balance) : ''}</td>
                      <td className={`px-1.5 py-0.5 ${inferred('preLeased')}`}>{u.preLeased ? 'Yes' : ''}</td>
                      <td className="px-1.5 py-0.5">{u.futureRent ? fmt.usdCents(u.futureRent) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {convertible && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3">
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">Save this mapping as a preset</span>
            <input className={`${input} w-56`} value={presetName} placeholder="e.g. Yardi rent roll export" onChange={(e) => setPresetName(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={savePreset}
            disabled={!presetName.trim()}
            className="rounded border border-slate-600 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save preset
          </button>
          {savedAs && <span className="pb-1 text-emerald-300">Saved “{savedAs}”: this layout converts automatically next time.</span>}
          <span className="ml-auto flex gap-3 pb-1">
            {presets.length > 0 && (
              <button
                type="button"
                className="text-slate-400 underline hover:text-slate-200"
                title="For npm run convert: save as private-deals/rent-roll-presets.json"
                onClick={() => downloadFile('rent-roll-presets.json', JSON.stringify(presetsFile(presets), null, 2) + '\n', 'application/json')}
              >
                Download presets file
              </button>
            )}
            <button
              type="button"
              className="text-slate-400 underline hover:text-slate-200 disabled:no-underline disabled:opacity-40"
              disabled={!!c.blockers.length}
              onClick={() => downloadFile(`${baseName}-unit-rent-roll.csv`, conversionCSV(c), 'text/csv;charset=utf-8')}
            >
              Download clean CSV
            </button>
          </span>
        </div>
      )}
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
  const p = PROVENANCE[provenance]
  return <span className={`w-20 shrink-0 rounded px-1 py-0.5 text-center text-[10px] ${p.className}`}>{p.label}</span>
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
