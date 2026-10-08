/**
 * Golden test: Westminster Office Tower, base scenario.
 *
 * These values were independently validated against the second Excel benchmark
 * (Westminster Office Tower, matched to the cent on Oct 8, 2026). Only update
 * __fixtures__/westminster-benchmark.csv on purpose when an assumption or method
 * changes, and re-check against Excel when you do. No script writes to the
 * fixture; `npm run underwrite` writes to docs/ instead.
 */
import { describe } from 'vitest'
import { SAMPLE_PROPERTIES } from '../../data/sampleProperties'
import fixture from './__fixtures__/westminster-benchmark.csv?raw'
import { goldenChecks } from './goldenChecks'
import { underwrite } from './underwrite'

const AS_OF = '2026-10-04'

const WESTMINSTER = SAMPLE_PROPERTIES.find((p) => p.id === 'sample-westminster-tower')
if (!WESTMINSTER) throw new Error('missing sample-westminster-tower')

describe('Westminster golden benchmark', () => {
  goldenChecks(underwrite(WESTMINSTER, AS_OF), fixture)
})
