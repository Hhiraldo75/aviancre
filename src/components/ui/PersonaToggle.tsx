import type { Persona } from '../../types'
import { useAppStore } from '../../store/useAppStore'

const PERSONAS: Persona[] = ['Analyst', 'Broker', 'Developer', 'Investment']

/** Segmented control that switches the sidebar's professional lens. */
export default function PersonaToggle() {
  const active = useAppStore((s) => s.activePersona)
  const setPersona = useAppStore((s) => s.setPersona)

  return (
    <div role="tablist" aria-label="Persona" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-900 p-1">
      {PERSONAS.map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={active === p}
          onClick={() => setPersona(p)}
          className={`rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${
            active === p ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  )
}
