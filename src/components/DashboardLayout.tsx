import { useAppStore, useSelectedProperty } from '../store/useAppStore'
import MapView from './map/MapView'
import PropertyPanel from './panel/PropertyPanel'
import PersonaToggle from './ui/PersonaToggle'
import FullUnderwritingPanel from './underwriting/FullUnderwritingPanel'

/**
 * Split-pane shell: live 3D map on the left, persona-driven sidebar on the right.
 * Both read the same Zustand store, so selecting a building on the map or in
 * the list updates everything together.
 */
export default function DashboardLayout() {
  const selected = useSelectedProperty()
  const underwritingOpen = useAppStore((s) => s.underwritingOpen)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <main className="relative flex-1 bg-slate-900">
        <MapView />
        {underwritingOpen && selected && <FullUnderwritingPanel property={selected} />}
      </main>

      <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-800 p-6">
        <header className="mb-4">
          <h1 className="text-base font-semibold">AVIANCRE</h1>
          <p className="text-xs text-slate-400">Providence CRE · sample dataset</p>
        </header>
        <PersonaToggle />
        <div className="mt-5">
          <PropertyPanel />
        </div>
      </aside>
    </div>
  )
}
