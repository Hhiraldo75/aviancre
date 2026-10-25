import { useRef } from 'react'
import { useAppStore, useSelectedProperty } from '../store/useAppStore'
import ScreeningList from './citywide/ScreeningList'
import MapView from './map/MapView'
import AddressSearch from './panel/AddressSearch'
import PropertyPanel from './panel/PropertyPanel'
import PersonaToggle from './ui/PersonaToggle'
import FullUnderwritingPanel from './underwriting/FullUnderwritingPanel'
import WelcomeScreen from './welcome/WelcomeScreen'

/**
 * Split-pane shell: live 3D map on the left, persona-driven sidebar on the right.
 * Both read the same Zustand store, so selecting a building on the map or in
 * the list updates everything together.
 */
export default function DashboardLayout() {
  const selected = useSelectedProperty()
  const underwritingOpen = useAppStore((s) => s.underwritingOpen)
  const welcomeOpen = useAppStore((s) => s.welcomeOpen)
  const screeningOpen = useAppStore((s) => s.citywideVisible && s.citywideListOpen)
  const openWelcome = useAppStore((s) => s.openWelcome)
  const searchRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Behind the welcome screen the map loads but can't be reached with the keyboard. */}
      <main inert={welcomeOpen} className="relative flex-1 bg-slate-900">
        <MapView />
        {screeningOpen && !(underwritingOpen && selected) && <ScreeningList />}
        {underwritingOpen && selected && <FullUnderwritingPanel property={selected} />}
      </main>

      <aside inert={welcomeOpen} className="w-96 shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-800 p-6">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src="/aviancre-mark.svg" width={28} height={28} alt="" />
            <div>
              <h1 className="text-base font-semibold">AVIANCRE</h1>
              <p className="text-xs text-slate-400">Providence CRE · sample dataset</p>
            </div>
          </div>
          <button
            type="button"
            onClick={openWelcome}
            aria-label="Show the welcome screen"
            title="Show the welcome screen"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 text-xs font-semibold text-slate-400 hover:border-slate-400 hover:text-slate-100"
          >
            ?
          </button>
        </header>
        <AddressSearch inputRef={searchRef} />
        <PersonaToggle />
        <div className="mt-5">
          <PropertyPanel />
        </div>
      </aside>

      {welcomeOpen && <WelcomeScreen onSearch={() => searchRef.current?.focus()} />}
    </div>
  )
}
