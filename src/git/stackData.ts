import { SimpleGit } from 'simple-git'
import { getBranchDivergence } from './branchData'

const PARENT_KEY = (branch: string) => `branch.${branch}.coco-parent`

/** Walk cap for `buildStack` — guards against cyclic/misconfigured parent pointers. */
const MAX_STACK_DEPTH = 50

export type StackEntry = {
  branch: string
  parent?: string
  /** Commits on `branch` not on `parent` (0 for the root entry). */
  ahead: number
  /** Commits on `parent` not on `branch` (0 for the root entry). */
  behind: number
}

/**
 * Read the recorded stack parent for `branch` from
 * `branch.<name>.coco-parent`. `git config --get` exits non-zero when the
 * key is unset — mirrored here as `undefined` rather than an error, same
 * pattern as `readBoolConfig` in `sparseCheckoutData.ts`.
 */
export async function getStackParent(git: SimpleGit, branch: string): Promise<string | undefined> {
  try {
    const out = (await git.raw(['config', '--get', PARENT_KEY(branch)])).trim()
    return out || undefined
  } catch {
    return undefined
  }
}

/**
 * Read every recorded stack parent pointer in one call via
 * `config --get-regexp`. Exits non-zero (caught → `{}`) when no keys match.
 *
 * Each output line is `branch.<name>.coco-parent <parentValue>`. `<name>`
 * may itself contain dots (e.g. `feat/x.y`), so the key is split on the
 * fixed `branch.` prefix / `.coco-parent` suffix rather than on `.`.
 */
export async function getAllStackParents(git: SimpleGit): Promise<Record<string, string>> {
  let output: string
  try {
    output = await git.raw(['config', '--get-regexp', '^branch\\..*\\.coco-parent$'])
  } catch {
    return {}
  }

  const parents: Record<string, string> = {}
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue

    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) continue

    const key = line.slice(0, spaceIdx)
    const value = line.slice(spaceIdx + 1)
    if (!key.startsWith('branch.') || !key.endsWith('.coco-parent')) continue

    const name = key.slice('branch.'.length, key.length - '.coco-parent'.length)
    if (!name) continue

    parents[name] = value
  }
  return parents
}

/**
 * Walk parent pointers starting at `currentBranch`, ordered root-most
 * ancestor first through `currentBranch` last. A visited-set stops cycles
 * and `MAX_STACK_DEPTH` bounds pathological chains; either condition just
 * truncates the walk rather than throwing.
 *
 * Per-edge ahead/behind comes from `getBranchDivergence`, which shells out
 * to `rev-list` — if a parent ref no longer exists (deleted branch, dangling
 * pointer) that call throws, so it's wrapped per-edge and degrades to
 * `{ahead: 0, behind: 0}` instead of failing the whole walk.
 */
export async function buildStack(
  git: SimpleGit,
  currentBranch: string,
  parents: Record<string, string>
): Promise<StackEntry[]> {
  const chain: string[] = []
  const visited = new Set<string>()

  let branch: string | undefined = currentBranch
  while (branch && !visited.has(branch) && chain.length < MAX_STACK_DEPTH) {
    visited.add(branch)
    chain.push(branch)
    branch = parents[branch]
  }
  chain.reverse()

  const entries: StackEntry[] = []
  for (let i = 0; i < chain.length; i++) {
    const branchName = chain[i]
    const parent = i > 0 ? chain[i - 1] : undefined

    let divergence: { ahead: number; behind: number } = { ahead: 0, behind: 0 }
    if (parent) {
      try {
        divergence = await getBranchDivergence(git, branchName, parent)
      } catch {
        // Dangling parent pointer — leave ahead/behind at 0.
      }
    }

    entries.push({ branch: branchName, parent, ahead: divergence.ahead, behind: divergence.behind })
  }
  return entries
}
