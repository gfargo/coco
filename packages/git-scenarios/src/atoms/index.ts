/**
 * Atom layer — composable building blocks for building scenarios.
 *
 * Two ways to use this package:
 *
 *   1. **Pick a named scenario** from the registry. `spinUpScenario`
 *      and `findScenario` cover this path. 90% of test consumers.
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
 * defining a custom scenario is just `defineScenario({ setup: chain(...) })`.
 */

export type { Step, FileMap } from './types'
export { chain, repeat } from './chain'
export { writeFiles } from './writeFiles'
export { stageFiles, commit } from './staging'
export { addCommit } from './addCommit'
export { switchToBranch, checkoutBranch } from './branches'
export { seededFiles, type SeededFileSpec } from './seededFiles'
export { defineScenario } from './defineScenario'
