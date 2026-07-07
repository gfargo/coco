import { SimpleGit } from 'simple-git'

const FIELD_SEPARATOR = '\x1f'

export type BranchRefType = 'local' | 'remote'

export type BranchRef = {
  type: BranchRefType
  name: string
  shortName: string
  hash: string
  upstream?: string
  current: boolean
  remote?: string
  date: string
  subject: string
  ahead: number
  behind: number
}

export type BranchOverview = {
  currentBranch?: string
  dirty: boolean
  localBranches: BranchRef[]
  remoteBranches: BranchRef[]
}

export function parseBranchRefs(output: string): BranchRef[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line): BranchRef | undefined => {
      const [refName, shortName, hash, upstream, head, date, subject, track] = line.split(FIELD_SEPARATOR)

      if (!refName || !shortName) {
        return undefined
      }

      if (
        refName.startsWith('refs/remotes/') &&
        (refName.endsWith('/HEAD') || shortName.endsWith('/HEAD'))
      ) {
        return undefined
      }

      const type: BranchRefType = refName.startsWith('refs/remotes/') ? 'remote' : 'local'
      const remote = type === 'remote' ? shortName.split('/')[0] : undefined

      // Parse %(upstream:track) — e.g. "[ahead 3, behind 2]", "[ahead 1]",
      // "[behind 5]", "[gone]", or empty string. Single subprocess for all
      // branches instead of one rev-list per branch (#1364).
      const { ahead, behind } = parseUpstreamTrack(track || '')

      return {
        type,
        name: refName,
        shortName,
        hash,
        upstream: upstream || undefined,
        current: head === '*',
        remote,
        date,
        subject,
        ahead,
        behind,
      }
    })
    .filter((ref): ref is BranchRef => Boolean(ref))
}

/**
 * Parse the `%(upstream:track)` format field from `git for-each-ref`.
 * Examples: "[ahead 3, behind 2]", "[ahead 1]", "[behind 5]", "[gone]", ""
 */
export function parseUpstreamTrack(track: string): Pick<BranchRef, 'ahead' | 'behind'> {
  if (!track || track === '[gone]') return { ahead: 0, behind: 0 }
  const aheadMatch = track.match(/ahead (\d+)/)
  const behindMatch = track.match(/behind (\d+)/)
  return {
    ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
  }
}

export function parseDivergence(output: string): Pick<BranchRef, 'ahead' | 'behind'> {
  const [behind = '0', ahead = '0'] = output.trim().split(/\s+/)

  return {
    ahead: Number.parseInt(ahead, 10) || 0,
    behind: Number.parseInt(behind, 10) || 0,
  }
}

export async function getBranchDivergence(
  git: SimpleGit,
  branch: string,
  upstream: string
): Promise<Pick<BranchRef, 'ahead' | 'behind'>> {
  return parseDivergence(await git.raw(['rev-list', '--left-right', '--count', `${upstream}...${branch}`]))
}

export async function getBranchOverview(git: SimpleGit): Promise<BranchOverview> {
  const [branchOutput, statusOutput, currentBranchOutput] = await Promise.all([
    git.raw([
      'for-each-ref',
      `--format=%(refname)${FIELD_SEPARATOR}%(refname:short)${FIELD_SEPARATOR}%(objectname:short)${FIELD_SEPARATOR}%(upstream:short)${FIELD_SEPARATOR}%(HEAD)${FIELD_SEPARATOR}%(committerdate:short)${FIELD_SEPARATOR}%(contents:subject)${FIELD_SEPARATOR}%(upstream:track)`,
      'refs/heads',
      'refs/remotes',
    ]),
    git.raw(['status', '--porcelain']),
    git.raw(['branch', '--show-current']),
  ])
  const refs = parseBranchRefs(branchOutput)
  const localBranches: BranchRef[] = refs
    .filter((entry) => entry.type === 'local')

  return {
    currentBranch: currentBranchOutput.trim() || undefined,
    dirty: statusOutput.trim().length > 0,
    localBranches,
    remoteBranches: refs.filter((entry) => entry.type === 'remote'),
  }
}
