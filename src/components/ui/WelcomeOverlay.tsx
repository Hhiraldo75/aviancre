import { useEffect, useId, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'

const RETAIL_DEMO_ID = 'sample-atwells-retail-row'
const MEMO_DEMO_ID = 'sample-fernhill-commons'

/**
 * First-visit welcome over the map (still visible behind it). Each action
 * closes the overlay and goes straight to that part of the app; Escape or a
 * click outside the card just closes it.
 */
export default function WelcomeOverlay({ onSearch }: { onSearch: () => void }) {
  const close = useAppStore((s) => s.closeWelcome)
  const select = useAppStore((s) => s.select)
  const openUnderwriting = useAppStore((s) => s.openUnderwriting)
  const firstRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const underwriteRetail = () => {
    close()
    select(RETAIL_DEMO_ID)
    openUnderwriting()
  }
  const searchAddress = () => {
    close()
    onSearch()
  }
  const readMemo = () => {
    close()
    select(MEMO_DEMO_ID)
    openUnderwriting('Analyst memo')
  }

  const action =
    'w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2.5 text-left text-sm font-medium text-slate-100 hover:border-blue-500 hover:bg-slate-700 focus:border-blue-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/50 p-4" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-5 text-slate-100 shadow-2xl sm:p-6"
      >
        <h2 id={titleId} className="text-xl font-semibold tracking-wide">
          AVIANCRE
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          A bird's-eye view of Providence commercial real estate, from 3D map to underwriting
        </p>
        <p className="mt-3 text-sm leading-snug text-slate-400">
          Click any building to pull its public tax, zoning and flood records, or open a sample property and run a full
          underwriting with cash flows, returns and an AI analyst's memo.
        </p>

        <div className="mt-5 space-y-2">
          <button ref={firstRef} type="button" onClick={underwriteRetail} className={action}>
            Underwrite a retail center
            <span className="block text-xs font-normal text-slate-400">Atwells Retail Row, full underwriting</span>
          </button>
          <button type="button" onClick={searchAddress} className={action}>
            Search any Providence address
            <span className="block text-xs font-normal text-slate-400">City parcel records, live</span>
          </button>
          <button type="button" onClick={readMemo} className={action}>
            Read an AI analyst memo
            <span className="block text-xs font-normal text-slate-400">Fernhill Commons, investment committee memo</span>
          </button>
        </div>

        <p className="mt-4 rounded-md bg-amber-500/10 p-3 text-xs leading-snug text-amber-300">
          Sample properties sit on real buildings, but their tenants and rents are fictional. Public records (tax roll,
          zoning, flood zones) are real.
        </p>

        <button
          type="button"
          onClick={close}
          className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          Explore the map
        </button>
      </section>
    </div>
  )
}
