import { Repository, Diff, Tree } from 'nodegit'
import config from '../../config'
import { EMPTY_GIT_TREE_HASH } from './constants'
import { parsePatches } from './parsePatches'
import { FileChange } from '../../types'

const DEFAULT_IGNORED_FILES = [
  ...(config?.ignoredFiles?.length && config?.ignoredFiles?.length > 0 ? config.ignoredFiles : []),
]

const DEFAULT_IGNORED_EXTENSIONS = [
  ...(config?.ignoredExtensions?.length && config?.ignoredExtensions?.length > 0
    ? config.ignoredExtensions
    : []),
]

export type GetChangesArgs = {
  ignoreUnstaged?: boolean
  ignoreUntracked?: boolean
  ignoredFiles?: string[]
  ignoredExtensions?: string[]
}

export type GetChangesResult = {
  staged: FileChange[]
  unstaged?: FileChange[]
  untracked?: FileChange[]
}

/**
 * The 'git status' for coco
 *
 * Get paths of changed files in the Git repository, excluding ignored files and extensions.
 *
 * @param {string[]} [options.ignoredFiles] - An optional array of file patterns to ignore.
 *    If not provided, it defaults to the `ignoredFiles` configuration value from the app's config.
 * @param {string[]} [options.ignoredExtensions] - An optional array of file extensions to ignore.
 *   If not provided, it defaults to the `ignoredExtensions` configuration value from the app's config.
 * @returns {Promise<GetChangesResult>} A Promise that resolves to an array of changed file paths.
 *
 * @example
 * const changes = await getStagedChanges()
 * console.log(changes)
 * // {
 * //   staged: [
 * //     {
 * //       filepath: 'src/index.ts',
 * //       action: 'modified'
 * //     },
 * //   ],
 * //   unstaged: [
 * //     {
 * //       filepath: 'src/index.test.ts',
 * //       action: 'added'
 * //     }
 * //   ]
 * // }
 */
export async function getChanges(
  repo: Repository,
  options: GetChangesArgs = {}
): Promise<GetChangesResult> {
  const {
    ignoredFiles = DEFAULT_IGNORED_FILES,
    ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS,
    ignoreUnstaged,
    ignoreUntracked,
  } = options
  const head = await repo.getHeadCommit()
  const index = await repo.refreshIndex()
  const tree = await (head ? await head.getTree() : Tree.lookup(repo, EMPTY_GIT_TREE_HASH))

  let unstaged: FileChange[] = []
  let untracked: FileChange[] = []

  if (!ignoreUnstaged) {
    const unstagedDiff = await Diff.indexToWorkdir(repo, index, {
      flags: Diff.OPTION.RECURSE_UNTRACKED_DIRS,
    })
    const unstagedPatches = await unstagedDiff.patches()
    unstaged = await parsePatches(unstagedPatches, { ignoredFiles, ignoredExtensions })
  }

  if (!ignoreUntracked) {
    const untrackedDiff = await Diff.treeToWorkdirWithIndex(repo, tree, {
      flags: Diff.OPTION.SHOW_UNTRACKED_CONTENT,
    })
    const untrackedPatches = await untrackedDiff.patches()
    untracked = (await parsePatches(untrackedPatches, { ignoredFiles, ignoredExtensions })).filter(
      ({ status }) => status === 'untracked'
    )
  }

  const diff = await Diff.treeToIndex(repo, tree, index)
  await diff.findSimilar({
    flags: Diff.FIND.RENAMES,
  })
  const patches = await diff.patches()

  return {
    staged: await parsePatches(patches, { ignoredFiles, ignoredExtensions }),
    unstaged,
    untracked,
  }
}
