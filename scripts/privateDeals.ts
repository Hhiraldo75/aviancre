/**
 * The private-deals/ folder: where real deals live, and the check that keeps
 * them out of Git. Node only (CLI scripts and their tests); the app never
 * reads this folder.
 */
import { execFileSync } from 'node:child_process'

export const PRIVATE_DIR = 'private-deals'
/** The one file in private-deals/ that is meant to be committed. */
export const ALLOWED = [`${PRIVATE_DIR}/README.md`]

/** Tracked or staged paths under private-deals/ that shouldn't be, from `git ls-files` output. */
export function forbiddenTracked(lsFilesOutput: string): string[] {
  return lsFilesOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((path) => path && !ALLOWED.includes(path))
}

function git(args: string[]): { stdout: string; status: number } {
  try {
    return { stdout: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? '', status: e.status ?? 1 }
  }
}

/**
 * Problems with the private folder: files Git tracks or has staged there
 * (the index is what `git ls-files` lists, so this is safe as a pre-commit
 * hook), or the folder no longer being ignored. Empty when all is well.
 */
export function privateDealProblems(): string[] {
  const problems = forbiddenTracked(git(['ls-files', '--', PRIVATE_DIR]).stdout).map(
    (path) => `${path} is tracked by Git. Untrack it (it stays on disk): git rm --cached "${path}"`,
  )
  if (git(['check-ignore', '-q', `${PRIVATE_DIR}/any-deal.json`]).status !== 0) {
    problems.push(`${PRIVATE_DIR}/ is not ignored by Git. .gitignore needs "${PRIVATE_DIR}/*" and "!${PRIVATE_DIR}/README.md".`)
  }
  return problems
}
