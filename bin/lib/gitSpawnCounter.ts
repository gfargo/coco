/**
 * Counts `child_process.spawn` calls made while a given function runs
 * (#1425). This is the one true choke point for `simple-git` — every
 * git invocation bottoms out at `spawn()` (see
 * `node_modules/simple-git/dist/cjs/index.js`, which calls
 * `import_child_process.spawn(...)` as a property lookup on the
 * `child_process` module object rather than a destructured binding).
 * That property-lookup style is what makes this patch effective:
 * mutating the *same* module-exports object simple-git reads from is
 * enough, with no need to intercept simple-git itself.
 *
 * `createRequire` (rather than `import * as childProcess from
 * 'node:child_process'`) is required here: under esbuild/tsx's CJS
 * output, a namespace import is copied into a fresh object, so
 * mutating it would patch a copy nobody else reads. `createRequire`
 * returns the real, single `node:child_process` module-exports object
 * from Node's module cache — the same object simple-git's own
 * `require('child_process')` resolves to.
 */
import type * as ChildProcessModule from 'node:child_process'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(`${process.cwd()}/`)
const childProcess = nodeRequire('node:child_process') as typeof ChildProcessModule

/**
 * Run `fn`, counting every `child_process.spawn` call made anywhere in
 * the process (not just by `fn` directly) while it's in flight, then
 * restore the original `spawn`. Callers are responsible for running
 * measured work serially — any concurrent/background git call during
 * the window pollutes the count.
 */
export async function withSpawnCount<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; spawnCount: number }> {
  const original = childProcess.spawn
  let spawnCount = 0
  childProcess.spawn = ((...args: Parameters<typeof original>) => {
    spawnCount += 1
    return original(...args)
  }) as typeof original

  try {
    const result = await fn()
    return { result, spawnCount }
  } finally {
    childProcess.spawn = original
  }
}
