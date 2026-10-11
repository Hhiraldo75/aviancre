/// <reference lib="dom" />
/**
 * Records a silent ~2-minute demo of the live site with captions.
 *
 *   npx vite-node scripts/demo-video.ts
 *
 * Records a 1920x1080 Chromium page with the GPU on (Metal), so the 3D map
 * renders smoothly, walks through the app with a visible cursor and a caption
 * bar, and saves ~/Desktop/aviancre-demo.webm, plus an .mp4 when ffmpeg is on
 * the PATH. The browser comes from `npx playwright install chromium` if it
 * isn't cached.
 *
 * It runs headless by default: a headed window is clipped to the screen, so on
 * a display under 1080 points tall (any MacBook) the video loses its bottom
 * rows. DEMO_HEADED=1 shows the window, for a large enough external display.
 *
 * Env: DEMO_URL (default the live site), DEMO_OUT (output .webm path),
 * DEMO_SHOTS (a folder: also saves a screenshot at the end of each step),
 * DEMO_HEADED=1.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Locator } from 'playwright'

const URL = process.env.DEMO_URL ?? 'https://aviancre.vercel.app'
const OUT = process.env.DEMO_OUT ?? join(homedir(), 'Desktop', 'aviancre-demo.webm')
const SHOTS = process.env.DEMO_SHOTS
const SIZE = { width: 1920, height: 1080 }

/** Caption bar and a fake cursor (Playwright's real one isn't recorded). Runs on every page load. */
function overlay() {
  // A fresh browser profile has no storage; clear it anyway, once, so the welcome screen shows.
  if (!sessionStorage.getItem('demo.cleared')) {
    localStorage.clear()
    sessionStorage.setItem('demo.cleared', '1')
  }
  const install = () => {
    const style = document.createElement('style')
    style.textContent = `
      #demo-caption { position: fixed; left: 50%; bottom: 40px; transform: translate(-50%, 12px); width: max-content; max-width: 1760px;
        padding: 18px 34px; border-radius: 14px; background: rgba(8, 10, 14, 0.82); color: #fff;
        font: 600 30px/1.35 system-ui, -apple-system, sans-serif; text-align: center; letter-spacing: -0.01em;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45); opacity: 0; transition: opacity 0.4s, transform 0.4s;
        pointer-events: none; z-index: 2147483647 }
      #demo-caption.on { opacity: 1; transform: translate(-50%, 0) }
      #demo-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; pointer-events: none;
        z-index: 2147483647; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5)) }
      #demo-cursor.down::after { content: ''; position: absolute; left: -14px; top: -14px; width: 28px; height: 28px;
        border-radius: 50%; background: rgba(96, 165, 250, 0.45) }
      .demo-spot { outline: 3px solid #fbbf24 !important; outline-offset: 4px; border-radius: 6px }`
    document.head.appendChild(style)
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2l0 21 6-5.5 4 9 3.6-1.6-4-8.9 8.4-.3z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    cursor.style.transform = `translate(${innerWidth / 2 - 3}px, ${innerHeight / 2 - 2}px)`
    document.body.append(caption, cursor)
    const at = (e: MouseEvent) => (cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`)
    window.addEventListener('mousemove', at, true)
    window.addEventListener('mousedown', () => cursor.classList.add('down'), true)
    window.addEventListener('mouseup', () => cursor.classList.remove('down'), true)
  }
  if (document.body) install()
  else document.addEventListener('DOMContentLoaded', install)
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const headed = process.env.DEMO_HEADED === '1'
  const browser = await chromium.launch({
    headless: !headed,
    // --window-size breaks headed recording on macOS (it captures only a corner of the page).
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  })
  const videoDir = mkdtempSync(join(tmpdir(), 'aviancre-demo-'))
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videoDir, size: SIZE } })
  await context.addInitScript(overlay)
  const page = await context.newPage()
  const video = page.video()!
  let mouse = { x: SIZE.width / 2, y: SIZE.height / 2 }
  let step = 0

  const caption = (text: string) =>
    page.evaluate((t) => {
      const el = document.getElementById('demo-caption')!
      el.classList.remove('on')
      setTimeout(() => {
        el.textContent = t
        el.classList.add('on')
      }, t ? 250 : 0)
    }, text)

  /** Holds the frame so the caption can be read, then saves a check screenshot if asked. */
  const hold = async (ms = 3500) => {
    await pause(ms)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `step-${step}.png`) })
  }

  /** Glides the cursor to the element's center; the number of steps scales with distance. */
  const moveTo = async (target: Locator) => {
    await target.scrollIntoViewIfNeeded()
    const box = (await target.boundingBox())!
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const steps = Math.max(12, Math.round(Math.hypot(to.x - mouse.x, to.y - mouse.y) / 18))
    await page.mouse.move(to.x, to.y, { steps })
    mouse = to
  }

  const click = async (target: Locator, after = 900) => {
    await target.waitFor({ state: 'visible', timeout: 20_000 })
    await moveTo(target)
    await pause(250)
    await page.mouse.down()
    await pause(90)
    await page.mouse.up()
    await pause(after)
  }

  /** Outlines an element for a moment to draw the eye to it. */
  const spotlight = async (target: Locator, ms = 2500) => {
    await target.evaluate((el) => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('demo-spot')
    })
    await pause(ms)
    await target.evaluate((el) => el.classList.remove('demo-spot'))
  }

  /** Smoothly scrolls the element's nearest scrollable container, with the cursor resting over it. */
  const scroll = async (over: Locator, dy: number) => {
    await moveTo(over)
    await over.evaluate((el, by) => {
      let box: HTMLElement | null = el as HTMLElement
      while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
      ;(box ?? document.scrollingElement!).scrollBy({ top: by, behavior: 'smooth' })
    }, dy)
    await pause(1500)
  }

  const panel = page.getByRole('dialog', { name: /Full underwriting/ })
  const sidebarTab = (name: string) => page.getByRole('tablist', { name: 'Persona' }).getByRole('tab', { name })
  const uwTab = (name: string) => panel.getByRole('tab', { name })
  const openProperty = async (name: RegExp) => {
    await click(page.getByRole('button', { name: '← All properties' }))
    await click(page.getByRole('button', { name }), 2500)
  }

  // A dark first frame instead of a white one while the site loads.
  await page.setContent('<body style="margin:0;background:#0A0C10"></body>')
  // Not 'load': that also waits for the map tiles loading behind the welcome screen.
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Enter the map' }).waitFor()
  await page.evaluate(() => document.fonts.ready)

  // 1. Welcome
  step = 1
  await page.mouse.move(mouse.x, mouse.y)
  await pause(800)
  await caption('AVIANCRE: a 3D commercial real estate tool for Providence, built by Henly Hiraldo')
  await hold(4500)

  // 2. Public record search
  step = 2
  await click(page.getByRole('button', { name: 'Enter the map' }), 3000)
  await caption("Any building's real public record: owner, value, zoning, flood zone")
  const search = page.getByRole('combobox', { name: 'Search an address in Providence' })
    .or(page.getByRole('textbox', { name: 'Search an address in Providence' }))
  await click(search, 300)
  await search.pressSequentially('25 Dorrance St', { delay: 130 })
  await click(page.getByRole('option', { name: /25 Dorrance St/ }).first(), 3500)
  await page.getByText(/tax roll/i).first().waitFor({ timeout: 20_000 })
  await hold(2500)
  await scroll(page.getByText(/building & lot/i).first(), 520)
  await hold(3500)

  // 3. Atwells cash flow
  step = 3
  await caption('Lease-by-lease, 10-year model: rollover, TI, leasing commissions, debt, sale')
  await openProperty(/Atwells Retail Row/)
  await click(sidebarTab('Investment'), 1200)
  await click(page.getByRole('button', { name: /Full underwriting/ }), 1500)
  await click(uwTab('Cash flow'), 800)
  await moveTo(panel.getByText('Net operating income').first())
  await hold(4000)

  // 4. Warnings
  step = 4
  await caption('Flags what an analyst would: 36% of space rolls in Year 2')
  await click(panel.locator('summary', { hasText: /warning/ }), 800)
  await spotlight(panel.locator('details li', { hasText: /rolls in year 2/i }), 3500)
  await hold(1000)

  // 5. Sensitivity and max bid
  step = 5
  await caption('Every grid cell re-runs the full model. Max bid ≈ $3.7M vs $4.15M price')
  await click(panel.locator('summary', { hasText: /warning/ }), 300)
  await click(uwTab('Returns'), 1500)
  await moveTo(panel.getByRole('heading', { name: /Exit cap × rent growth/i }).first().or(panel.getByText(/Exit cap × rent growth/i).first()))
  await hold(3000)
  await spotlight(page.getByText(/Max bid at/).first(), 4000)
  await hold(500)

  // 6. Live assumptions
  step = 6
  await caption('Change any assumption and everything updates instantly')
  await click(uwTab('Assumptions'), 1000)
  const exitCap = panel.getByRole('textbox', { name: 'Exit cap rate' })
  await exitCap.scrollIntoViewIfNeeded()
  await click(exitCap, 300)
  await exitCap.selectText()
  await pause(400)
  await exitCap.pressSequentially('7.75', { delay: 260 })
  await pause(800)
  await spotlight(panel.locator('header').getByText('Levered IRR', { exact: true }).locator('..'), 3500)
  await hold(1000)

  // 7. Fernhill memo
  step = 7
  await caption('Apartments modeled unit by unit. AI analyst memo, with every number from the engine')
  await click(page.getByRole('button', { name: 'Close full underwriting' }), 800)
  await openProperty(/Fernhill Commons/)
  await click(page.getByRole('button', { name: /Full underwriting/ }), 1500)
  await click(uwTab('Analyst memo'), 2000)
  await hold(2500)
  await scroll(panel.getByRole('tabpanel'), 700)
  await hold(3500)

  // 8. Back to the welcome screen
  step = 8
  await click(page.getByRole('button', { name: 'Close full underwriting' }), 600)
  await click(page.getByRole('button', { name: 'Show the welcome screen' }), 600)
  await caption('Validated against two Excel models, to the cent · 600+ tests · code on GitHub')
  await hold(6000)
  await caption('')
  await pause(800)

  await context.close()
  mkdirSync(join(OUT, '..'), { recursive: true })
  await video.saveAs(OUT)
  await browser.close()
  rmSync(videoDir, { recursive: true, force: true })
  console.log(`Saved ${OUT}`)

  try {
    const mp4 = OUT.replace(/\.webm$/, '.mp4')
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4])
    console.log(`Saved ${mp4}`)
  } catch {
    console.log('ffmpeg not found (or failed): kept the .webm only')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
