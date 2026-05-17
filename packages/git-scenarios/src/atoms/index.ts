/**
 * Atom layer — composable building blocks for assembling scenarios.
 *
 * Two ways to use this package:
 *
 *   1. **Pick a named scenario** from the registry. `spinUpScenario`
 *      and `findScenario` cover this path. Default for test consumers.
 *   2. **Compose your own** from atoms. Use this when:
 *      - the registered scenarios don't match what your test needs
 *      - you're writing a tool's own scenario library and just want
 *        the building blocks
 *      - you're building inline in a test without registering
 *
 *   const repo = await createTempGitRepo()
 *   await chain(
 *     addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
 *     switchToBranch('feat/x'),
 *     seededFiles({ files: [{ path: 'src/foo.ts', tokens: 80 }], seed: 0xabc }),
 *     addCommit({ message: 'feat: add foo' }),
 *   )(repo)
 *
 * Every atom returns a `Step` — `(repo: TempGitRepo) => Promise<void>`.
 * Scenarios in the registry use these same atoms under the hood;
 * defining a custom scenario is `defineScenario({ setup: chain(…) })`.
 *
 * Atom catalog:
 *
 *   - **Control flow**: `chain`, `repeat`
 *   - **Working tree**: `writeFiles`, `seededFiles`
 *   - **Staging + commits**: `stageFiles`, `commit`, `addCommit`,
 *     `emptyCommit`, `amendCommit`
 *   - **Branches**: `switchToBranch`, `checkoutBranch`, `createBranch`,
 *     `deleteBranch`
 *   - **Tags**: `createTag`, `deleteTag`
 *   - **Remotes**: `addRemote`, `removeRemote`, `renameRemote`
 *   - **Stash**: `stashChanges`, `applyStash`, `popStash`, `dropStash`
 *   - **Operations**: `startMerge`, `abortMerge`, `startBisect`,
 *     `bisectStep`, `resetBisect`, `resetTo`
 *   - **Submodules**: `addSubmodule`, `pinSubmodule`
 *   - **Scoping**: `onBranch`, `insideSubmodule`
 *   - **Scenarios**: `defineScenario`
 */

export type { Step, FileMap } from './types'
export { chain, repeat } from './chain'
export { writeFiles } from './writeFiles'
export { stageFiles, commit } from './staging'
export { addCommit } from './addCommit'
export { switchToBranch, checkoutBranch, createBranch, deleteBranch } from './branches'
export { createTag, deleteTag } from './tags'
export { addRemote, removeRemote, renameRemote } from './remotes'
export { stashChanges, applyStash, popStash, dropStash } from './stash'
export {
  startMerge,
  abortMerge,
  startBisect,
  bisectStep,
  resetBisect,
  resetTo,
  emptyCommit,
  amendCommit,
} from './operations'
export { addSubmodule, pinSubmodule } from './submodule'
export { onBranch, insideSubmodule } from './scopes'
export { seededFiles, type SeededFileSpec } from './seededFiles'
export { defineScenario } from './defineScenario'
export { daysAgo } from './time'
