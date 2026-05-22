/**
 * Pure helper for rewriting the `--run-ui` shortcut documented by coco
 * into the `--run <cmd>` form that `@gfargo/git-scenarios`'s CLI
 * actually understands.
 *
 * Lives in its own module (separate from the entry script
 * `bin/scenarioRunner.ts`) so unit tests can import it without
 * pulling in the script's `import.meta.url` direct-invocation guard
 * — that line is ESM-only and ts-jest's CJS transform chokes on it.
 */
import path from 'node:path'

export const RUN_UI_FLAG = '--run-ui'

/**
 * Rewrite every occurrence of `--run-ui` in `argv` to the equivalent
 * `--run "tsx <root>/src/index.ts ui"` so the underlying git-scenarios
 * CLI can launch the workstation. Every other arg passes through
 * unchanged; the function is a no-op when `--run-ui` is absent.
 *
 * `root` is the coco repository root (passed in so callers can resolve
 * it however they want — from `import.meta.url`, `process.cwd()`, or
 * a fixed path under test).
 */
export function rewriteRunUi(argv: string[], root: string): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (arg === RUN_UI_FLAG) {
      out.push('--run', `tsx ${path.join(root, 'src/index.ts')} ui`)
      continue
    }
    out.push(arg)
  }
  return out
}
