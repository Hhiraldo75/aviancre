import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Property } from '../../types'
import { fromImport } from '../../lib/sourced'
import { t12File } from '../../lib/t12'
import { t12Check, type T12Check } from '../../lib/underwriting/t12Check'
import { useAppStore, useAssumptionEdits } from '../../store/useAppStore'
import { Card, Note } from '../ui/Card'
import { downloadFile } from '../ui/download'
import SourceBadge from '../ui/SourceBadge'
import AssumptionNotice from './AssumptionNotice'
import ImportT12Dialog from './ImportT12Dialog'

const BUTTON = 'rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800'
const EFFECT_TONE = (x: number | null) => (x === null || Math.round(x) === 0 ? 'text-slate-500' : x > 0 ? 'text-emerald-400' : 'text-amber-300')

/**
 * The T-12 in the Investment view: load one, or check the underwriting
 * against it (NOI line by line, taxes vs the tax roll, expense ratio and
 * $/unit vs the benchmark, and what it did to price and returns). Renders
 * `t12Check`'s figures only, no math.
 */
export default function T12Card({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const edits = useAssumptionEdits(p.id)
  const removeT12 = useAppStore((s) => s.removeT12)
  const record = useAppStore((s) => (s.dealRecord?.id === p.id ? s.dealRecord.lookup : null))
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const check = useMemo(() => {
    const tax = record ? { record: record.status === 'loaded' ? record.record : null, loading: record.status === 'loading' } : undefined
    return t12Check(p, asOf, edits, tax)
  }, [p, asOf, edits, record])

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".csv,.xlsx"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) setFile(f)
      }}
    />
  )
  const dialog = file && <ImportT12Dialog property={p} file={file} onClose={() => setFile(null)} />

  if (!check) {
    return (
      <Card title="T-12 operating statement">
        <p className="text-xs leading-snug text-slate-300">
          Load a trailing-12-month statement to replace the estimated Year-1 operating expenses and other income with actuals and check the underwriting against
          it. Revenue still comes from the rent roll.
        </p>
        <AssumptionNotice propertyId={p.id} />
        <button type="button" onClick={() => input.current?.click()} className="mt-3 text-xs font-medium text-sky-300 hover:text-sky-200">
          Load T-12 (CSV or Excel)…
        </button>
        <Note>Read in this browser only and kept here, apart from the rent roll; nothing is uploaded.</Note>
        {picker}
        {dialog}
      </Card>
    )
  }

  const act = fromImport(0, check.source, p.t12!.importedAt)
  return (
    <Card
      title="T-12 check"
      aside={
        <span className="text-[10px] text-slate-400">
          {check.period}
          <SourceBadge data={act} />
        </span>
      }
    >
      <p className="mb-2 truncate text-[10px] text-slate-500" title={check.fileName}>
        {check.fileName}
        {check.isSample && ' · fictional sample data'} · Base case at your current assumptions
      </p>
      <AssumptionNotice propertyId={p.id} />

      <Bridge check={check} />

      {check.reportedNOI?.note && <p className="mt-2 text-[10px] leading-snug text-slate-400">{check.reportedNOI.note}</p>}
      <p className="mt-1 text-[10px] leading-snug text-slate-500">T-12 lines are grown {check.growth}. NOI effect: what the underwritten figure adds to (+) or takes from (−) NOI against the T-12.</p>

      <Section title="Other income">
        <Pair label="T-12, grown (used)" value={check.otherIncome.t12Year1.display} />
        <Pair label={p.rentRoll.kind === 'multifamily' ? 'Rent roll (replaced)' : 'Without a T-12'} value={check.otherIncome.rentRoll.display} />
      </Section>

      <Section title="Checks">
        <Pair label="Management fee, T-12" value={`${check.managementFee.t12.display} · ${check.managementFee.t12PctOfEGI.display} of EGI`} hint={`Model ${check.managementFee.modelPct.display} of EGI: ${check.managementFee.underwritten.display}`} />
        {check.tax.status === 'ok' ? (
          <Pair
            label="Property taxes vs tax roll"
            value={`${check.tax.t12.display} vs ${check.tax.taxRoll.display}`}
            hint={`${check.tax.difference.display} (${check.tax.differencePct.display}) · ${check.tax.note}`}
            badge
          />
        ) : (
          <Pair label="Property taxes vs tax roll" value="—" hint={check.tax.reason} />
        )}
        <Pair
          label="Expense ratio"
          value={`T-12 ${check.expenseRatio.t12.display} · UW ${check.expenseRatio.underwritten.display}`}
          hint={`Benchmark ${check.expenseRatio.benchmark.display} EST: against an estimate`}
          title={check.expenseRatio.note}
        />
        <Pair
          label={`Opex per ${p.rentRoll.kind === 'multifamily' ? 'unit' : 'SF'}`}
          value={`T-12 ${check.perBasis.t12.display.replace('/yr', '')} · UW ${check.perBasis.underwritten.display.replace('/yr', '')}`}
          hint={`Benchmark ${check.perBasis.benchmark.display} EST: against an estimate; before the management fee`}
          title={check.perBasis.note}
        />
      </Section>

      <Section title="Below NOI">
        {check.belowNOI.t12.map((x) => (
          <Pair key={x.label} label={`T-12 · ${x.label}`} value={x.amount.display} />
        ))}
        {check.belowNOI.underwritten.map((x) => (
          <Pair key={x.label} label={`UW Year 1 · ${x.label}`} value={x.amount.display} />
        ))}
      </Section>

      <Section title="Effect of the T-12">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th />
              <th className="pb-1 pl-2 text-right font-medium">Without</th>
              <th className="pb-1 pl-2 text-right font-medium">With T-12</th>
              <th className="pb-1 pl-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {check.effect.map((e) => (
              <tr key={e.label} className="border-t border-slate-700/70">
                <th scope="row" className="py-1 pr-1 text-left font-normal text-slate-300">
                  {e.label}
                </th>
                <td className="whitespace-nowrap py-1 pl-2 text-right text-slate-400">{e.without.display}</td>
                <td className="whitespace-nowrap py-1 pl-2 text-right font-semibold">{e.with.display}</td>
                <td className="whitespace-nowrap py-1 pl-2 text-right text-slate-300">{e.change.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-400">{check.effectNote}</p>
      </Section>

      {check.flags.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-300">
          {check.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-700 pt-3">
        <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
          Replace…
        </button>
        <button
          type="button"
          className={BUTTON}
          title={`For npm run underwrite: save as private-deals/${p.id}/t12.json`}
          onClick={() => downloadFile(`${p.id}-t12.json`, JSON.stringify(t12File(p.id, p.t12!), null, 2) + '\n', 'application/json')}
        >
          Download mapped T-12
        </button>
        <button
          type="button"
          className={`${BUTTON} ml-auto border-red-500/40 text-red-300 hover:bg-red-500/10`}
          onClick={() => window.confirm('Remove the T-12? Year-1 expenses go back to the benchmark estimate.') && removeT12(p.id)}
        >
          Remove T-12
        </button>
      </div>
      <Note>
        Kept in this browser, apart from the rent roll; nothing is uploaded. For the command line, save the download as{' '}
        <code className="text-slate-400">private-deals/{p.id}/t12.json</code>.
      </Note>
      {picker}
      {dialog}
    </Card>
  )
}

function Bridge({ check }: { check: T12Check }) {
  return (
    <table className="w-full table-fixed border-collapse text-[11px] tabular-nums">
      <colgroup>
        <col className="w-[34%]" />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-slate-500">
          <th className="pb-1 text-left font-medium normal-case tracking-normal">$000s</th>
          <th className="pb-1 text-right font-medium">T-12</th>
          <th className="pb-1 text-right font-medium">UW Yr 1</th>
          <th className="pb-1 text-right font-medium">NOI effect</th>
        </tr>
      </thead>
      <tbody>
        {check.rows.map((row) => (
          <tr
            key={row.key}
            title={[`T-12 ${row.t12.display} · Year 1 ${row.underwritten.display} · NOI effect ${row.noiEffect.display}`, row.why].filter(Boolean).join('\n')}
            className={`border-t align-top ${row.kind === 'total' ? 'border-slate-600 font-semibold' : 'border-slate-700/70'}`}
          >
            <th scope="row" className={`py-1 pr-1 text-left leading-tight ${row.kind === 'total' ? 'font-semibold text-slate-200' : 'font-normal text-slate-300'}`}>
              {row.label}
            </th>
            <td className="py-1 text-right text-slate-400">{row.t12.k}</td>
            <td className="py-1 text-right">{row.underwritten.k}</td>
            <td className={`py-1 text-right ${EFFECT_TONE(row.noiEffect.value)}`}>{row.noiEffect.k}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="pt-1.5 text-[10px] leading-snug text-slate-300">
            Underwritten Year-1 NOI {check.noi.underwritten.display} is {check.noi.difference.display} ({check.noi.differencePct.display}) against the T-12’s{' '}
            {check.noi.t12.display}. Hover a line for why.
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-slate-700 pt-2">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Pair({ label, value, hint, badge, title }: { label: string; value: string; hint?: string; badge?: boolean; title?: string }) {
  return (
    <div className="text-[11px] leading-snug" title={title}>
      <div className="flex justify-between gap-2">
        <span className="text-slate-400">{label}</span>
        <span className="text-right font-medium tabular-nums text-slate-200">
          {value}
          {badge && <SourceBadge data={{ source: 'public', sourceName: 'City of Providence tax roll' }} />}
        </span>
      </div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  )
}
