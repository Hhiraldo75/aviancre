import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { forbiddenTracked, privateDealProblems } from './privateDeals'

describe('private-deals/ stays out of Git', () => {
  it('has nothing tracked or staged besides its README, and is ignored', () => {
    expect(privateDealProblems()).toEqual([])
  })

  it('flags any tracked file other than the README', () => {
    expect(forbiddenTracked('private-deals/README.md\n')).toEqual([])
    expect(forbiddenTracked('private-deals/README.md\nprivate-deals/deal-x.json\nprivate-deals/deal-x/memo.md\n')).toEqual([
      'private-deals/deal-x.json',
      'private-deals/deal-x/memo.md',
    ])
  })
})

describe('the app never bundles private-deals/', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

  it('has no import or glob of private-deals/ under src/', () => {
    const offenders = files('src').filter((f) =>
      /(from\s+|import\s*\(\s*|import\.meta\.glob\w*\s*\(\s*\[?\s*)['"`][^'"`]*private-deals/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
