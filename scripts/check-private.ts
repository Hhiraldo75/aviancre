/**
 * Fails if anything in private-deals/ (besides its README) is tracked or
 * staged, or if the folder is no longer ignored. Safe as a pre-commit hook.
 *
 *   npm run check-private
 */
import { PRIVATE_DIR, privateDealProblems } from './privateDeals'

const problems = privateDealProblems()
if (problems.length) {
  console.error(`${PRIVATE_DIR}/ check failed:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`${PRIVATE_DIR}/ check passed: nothing in it is tracked, and it is ignored.`)
