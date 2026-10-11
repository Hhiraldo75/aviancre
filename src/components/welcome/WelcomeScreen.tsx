import { useEffect, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import CityBlock from './CityBlock'
import FeaturedDealCard from './FeaturedDealCard'
import StarField from './StarField'

const RETAIL_DEMO_ID = 'sample-atwells-retail-row'
const MEMO_DEMO_ID = 'sample-fernhill-commons'
const GITHUB_URL = 'https://github.com/Hhiraldo75/aviancre'

/** Page column: 1240px wide, gutters from 20 to 48px. */
const COLUMN = 'mx-auto max-w-[1240px] px-[clamp(20px,4vw,48px)]'
const EYEBROW = 'm-0 font-plex text-xs uppercase tracking-[0.16em] text-av-muted'
const SECTION_GAP = 'pt-[clamp(48px,5vw,72px)]'

const LEGEND = [
  { color: 'bg-av-green', label: '90%+ leased' },
  { color: 'bg-av-amber', label: '80–90%' },
  { color: 'bg-av-red', label: 'Under 80%' },
  { color: 'bg-av-blue', label: 'Selected' },
  { color: 'bg-av-context', label: 'Context' },
]

const BADGES = [
  { tag: 'PUB', className: 'text-av-accent border-[#2E4A7A]', label: 'Public record' },
  { tag: 'ACT', className: 'text-av-green border-[#23573D]', label: 'Your rent roll' },
  { tag: 'EST', className: 'text-av-amber border-[#6B5020]', label: 'Estimate' },
  { tag: 'USER', className: 'text-av-ink border-[#4A5464]', label: 'Your edit' },
]

const FACTS = [
  { big: '610+', small: 'automated tests on every calculation' },
  { big: 'To the cent', small: 'matched to 2 independent Excel models' },
  { big: '6 sources', small: 'of free public city and state data' },
  { big: '4 lenses', small: 'Analyst, Broker, Developer, Investment' },
]

function ArrowIcon({ size, strokeWidth = 2.2 }: { size: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

/** Card icon: 24px line art on the dark blue tile. */
function CardIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-av-icon-bg">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B95FF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  )
}

function TryCard({ icon, title, body, cta, onClick }: { icon: ReactNode; title: string; body: string; cta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="box-border flex flex-col gap-3 rounded-xl border border-av-line bg-av-card px-6 py-[22px] text-left text-av-ink hover:border-av-callout-line focus-visible:outline-2 focus-visible:outline-av-accent"
    >
      <CardIcon>{icon}</CardIcon>
      <span className="text-xl font-bold leading-[1.2]">{title}</span>
      <span className="text-[15px] text-av-body">{body}</span>
      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-av-accent">
        {cta}
        <ArrowIcon size={15} />
      </span>
    </button>
  )
}

/**
 * Full-page welcome shown before the map on a first visit. "Enter the map",
 * "Skip to map" and Escape dismiss it; each "Try this" card dismisses it and
 * opens that part of the app. The map loads behind it meanwhile.
 */
export default function WelcomeScreen({ onSearch }: { onSearch: () => void }) {
  const close = useAppStore((s) => s.closeWelcome)
  const select = useAppStore((s) => s.select)
  const openUnderwriting = useAppStore((s) => s.openUnderwriting)
  const enterRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    enterRef.current?.focus({ preventScroll: true })
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
    // The sidebar is inert until the screen has closed, and an inert input can't take focus.
    flushSync(close)
    onSearch()
  }
  const readMemo = () => {
    close()
    select(MEMO_DEMO_ID)
    openUnderwriting('Analyst memo')
  }

  const link = 'text-av-link hover:text-white'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AVIANCRE"
      className="fixed inset-0 z-40 overflow-y-auto bg-av-bg font-manrope text-[17px] leading-[1.55] text-av-ink antialiased"
    >
      <header className={`${COLUMN} flex flex-wrap items-center justify-between gap-3.5 py-[22px]`}>
        <div className="flex items-center gap-2.5">
          <img src="/aviancre-mark.svg" width={40} height={40} alt="" />
          <span className="text-[19px] font-extrabold tracking-[0.12em]">AVIANCRE</span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <span className="font-plex text-xs text-av-muted">Providence, RI · V5</span>
          <button type="button" onClick={close} className={`inline-flex min-h-11 items-center text-sm font-semibold ${link}`}>
            Skip to map
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden border-y border-av-edge bg-av-bg bg-[radial-gradient(ellipse_70%_90%_at_72%_0%,#101B30_0%,#0A0C10_70%)]">
        <StarField />
        <div className={`${COLUMN} relative z-[1] flex flex-wrap items-center gap-10 py-[clamp(44px,6vw,88px)]`}>
          <div className="flex min-w-0 flex-[6_1_520px] flex-col gap-6">
            <p className={EYEBROW}>3D commercial real estate intelligence</p>
            <h1 className="m-0 text-[clamp(40px,4vw,58px)] font-extrabold leading-[1.02] tracking-[-0.035em]">
              Watch the city.
              <br />
              <span className="text-av-accent">Underwrite the deal.</span>
            </h1>
            <p className="m-0 max-w-[34em] text-lg text-pretty text-av-body">
              AVIANCRE maps Providence in 3D. Click any building for its official public record, then open a sample property
              for a lease-by-lease, 10-year underwriting that updates the moment you change an assumption.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <button
                ref={enterRef}
                type="button"
                onClick={close}
                className="inline-flex min-h-[52px] items-center gap-2.5 rounded-lg bg-av-blue px-[26px] text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-av-accent"
              >
                Enter the map
                <ArrowIcon size={18} />
              </button>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center gap-2 text-base font-semibold ${link}`}>
                Read the code on GitHub
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17L17 7" />
                  <path d="M8 7h9v9" />
                </svg>
              </a>
            </div>
          </div>

          <div className="relative min-w-0 flex-[5_1_420px]">
            <CityBlock />
            <FeaturedDealCard />
          </div>
        </div>
      </section>

      <section className={`${COLUMN} ${SECTION_GAP} flex flex-col gap-4`}>
        <p className={EYEBROW}>Try this</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
          <TryCard
            icon={
              <>
                <path d="M3 21h18" />
                <path d="M6 21V10l6-4 6 4v11" />
                <path d="M10 21v-5h4v5" />
              </>
            }
            title="Underwrite a retail center"
            body="Atwells Retail Row: rent roll, 10-year cash flow, IRRs, DSCR, sensitivity grids and max bid."
            cta="Open underwriting"
            onClick={underwriteRetail}
          />
          <TryCard
            icon={
              <>
                <circle cx="11" cy="11" r="6.5" />
                <path d="M20 20l-4.2-4.2" />
              </>
            }
            title="Search any Providence address"
            body="Fly to the building and pull its owner, assessed value, taxes, zoning and flood zone."
            cta="Start a search"
            onClick={searchAddress}
          />
          <TryCard
            icon={
              <>
                <path d="M14 3H6v18h12V7z" />
                <path d="M14 3v4h4" />
                <path d="M9 12h6" />
                <path d="M9 16h6" />
              </>
            }
            title="Read an AI analyst memo"
            body="Fernhill Commons: an investment memo written after the AI analyst runs the tests and the engine."
            cta="Read the memo"
            onClick={readMemo}
          />
        </div>
        <p className="m-0 mt-1 flex max-w-[52em] items-start gap-2.5 text-sm text-av-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E5A93B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[3px] shrink-0">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </svg>
          <span>
            Sample properties sit on real Providence buildings, with real addresses, footprints and heights. Their names, tenants
            and rents are fictional.
          </span>
        </p>
      </section>

      <section className={`${COLUMN} ${SECTION_GAP}`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] gap-4">
          <div className="flex flex-col gap-4 rounded-xl border border-av-line bg-av-card p-6">
            <h2 className="m-0 text-xl font-bold">Reading the map</h2>
            <div className="flex flex-wrap gap-x-[22px] gap-y-2.5 text-sm text-av-link">
              {LEGEND.map((l) => (
                <span key={l.label} className="inline-flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-[3px] ${l.color}`} />
                  {l.label}
                </span>
              ))}
            </div>
            <p className="m-0 text-sm text-av-muted">
              Sample properties are drawn at their real OpenStreetMap footprints and heights, colored by how much of the
              building is leased.
            </p>
          </div>
          <div className="flex flex-col gap-4 rounded-xl border border-av-line bg-av-card p-6">
            <h2 className="m-0 text-xl font-bold">Every number shows its source</h2>
            <div className="flex flex-wrap gap-x-5 gap-y-2.5 text-sm text-av-link">
              {BADGES.map((b) => (
                <span key={b.tag} className="inline-flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-px font-plex text-[11px] font-medium ${b.className}`}>{b.tag}</span>
                  {b.label}
                </span>
              ))}
            </div>
            <p className="m-0 text-sm text-av-muted">
              Look for the badge beside each value to see what's real, what's yours and what's an estimate.
            </p>
          </div>
        </div>
      </section>

      <section className={`${COLUMN} ${SECTION_GAP}`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] border-y border-av-line">
          {FACTS.map((f) => (
            <div key={f.big} className="flex flex-col gap-0.5 py-6 pr-6">
              <span className="text-[32px] font-extrabold tracking-[-0.02em]">{f.big}</span>
              <span className="text-sm text-av-muted">{f.small}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className={`${COLUMN} flex flex-wrap justify-between gap-x-10 gap-y-3 pb-9 pt-8 text-[13px] text-av-muted`}>
        <span>Personal portfolio project · Not for investment decisions</span>
        <span>Map data © OpenStreetMap contributors</span>
      </footer>
    </div>
  )
}
