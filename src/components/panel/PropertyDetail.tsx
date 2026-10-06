import type { Persona, Property } from '../../types'
import { fmt } from '../../lib/format'
import { occupancy } from '../../lib/metrics'
import { useAppStore } from '../../store/useAppStore'
import AnalystView from '../personas/AnalystView'
import BrokerView from '../personas/BrokerView'
import DeveloperView from '../personas/DeveloperView'
import InvestmentView from '../personas/InvestmentView'
import { Chip } from '../ui/Card'

const VIEWS: Record<Persona, (props: { property: Property }) => ReturnType<typeof AnalystView>> = {
  Analyst: AnalystView,
  Broker: BrokerView,
  Developer: DeveloperView,
  Investment: InvestmentView,
}

/** Selected-property shell: shared header, then the active persona's cards. */
export default function PropertyDetail({ property: p }: { property: Property }) {
  const asOf = useAppStore((s) => s.asOf)
  const select = useAppStore((s) => s.select)
  const persona = useAppStore((s) => s.activePersona)
  const View = VIEWS[persona]

  return (
    <div>
      <button onClick={() => select(null)} className="mb-2 text-xs text-slate-400 hover:text-slate-100">
        ← All properties
      </button>
      <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        <Chip>{fmt.label(p.assetType)}</Chip>
        <Chip>Class {p.buildingClass}</Chip>
        <Chip>{fmt.label(p.location.submarket)}</Chip>
        <Chip>{fmt.pct(occupancy(p, asOf), 0)} leased</Chip>
        {p.isSample && <Chip tone="amber">Sample data</Chip>}
      </div>
      <div className="mt-4">
        <View property={p} />
      </div>
    </div>
  )
}
