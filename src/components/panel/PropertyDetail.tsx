import type { Persona, Property } from '../../types'
import { fmt } from '../../lib/format'
import { occupancy } from '../../lib/metrics'
import { useAppStore, usePropertyView } from '../../store/useAppStore'
import AnalystView from '../personas/AnalystView'
import BrokerView from '../personas/BrokerView'
import DeveloperView from '../personas/DeveloperView'
import InvestmentView from '../personas/InvestmentView'
import { Chip } from '../ui/Card'
import ImportedChip from '../ui/ImportedChip'
import DealLocation, { DealPublicRecord } from './DealLocation'

const VIEWS: Record<Persona, (props: { property: Property }) => ReturnType<typeof AnalystView>> = {
  Analyst: AnalystView,
  Broker: BrokerView,
  Developer: DeveloperView,
  Investment: InvestmentView,
}

/** Selected-property shell: shared header, then the active persona's cards. */
export default function PropertyDetail({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const clear = useAppStore((s) => s.clearSelection)
  const removeImportedDeal = useAppStore((s) => s.removeImportedDeal)
  const persona = useAppStore((s) => s.activePersona)
  const View = VIEWS[persona]
  const { matchIds } = usePropertyView()

  return (
    <div>
      <button onClick={clear} className="mb-2 text-xs text-slate-400 hover:text-slate-100">
        ← All properties
      </button>
      <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
      {!p.importedFrom && (
        <p className="mt-0.5 text-xs text-slate-400">
          {p.location.address}, {p.location.city}, {p.location.state} {p.location.zip}
          {p.location.parcelId && ` · Tax map ${p.location.parcelId}`}
          {p.isSample && ' · Real parcel; building, tenant and financial figures are sample data'}
        </p>
      )}
      {p.importedFrom && <DealLocation key={p.id} property={p} />}
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        <Chip>{fmt.label(p.assetType)}</Chip>
        <Chip>Class {p.buildingClass}</Chip>
        <Chip>{fmt.label(p.location.submarket)}</Chip>
        <Chip>{fmt.pct(occupancy(p, asOf), 0)} leased</Chip>
        {p.isSample && <Chip tone="amber">Sample data</Chip>}
        {p.importedFrom && <ImportedChip from={p.importedFrom} />}
      </div>
      {!matchIds.has(p.id) && <p className="mt-1.5 text-[11px] text-amber-300">Doesn’t match current filters</p>}
      <div className="mt-4">
        {p.importedFrom && <DealPublicRecord property={p} />}
        <View property={p} />
      </div>
      {p.importedFrom && (
        <button
          type="button"
          onClick={() => window.confirm(`Remove ${p.name} from this browser? Your file is not affected.`) && removeImportedDeal(p.id)}
          className="mt-4 w-full rounded border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
        >
          Remove imported deal
        </button>
      )}
    </div>
  )
}
