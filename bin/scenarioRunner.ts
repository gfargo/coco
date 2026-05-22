#!/usr/bin/env tsx
/**
 * `npm run scenario` wrapper.
 *
 * `@gfargo/git-scenarios`'s CLI knows about `--run <cmd>` (tool-agnostic
 * launcher — any shell command). Coco's docs and wiki advertise a
 * convenience flag `--run-ui` that should spawn the source-tree CLI
 * (`tsx <coco>/src/index.ts ui`) against the materialized scenario —
 * but the flag isn't a real `git-scenarios` option, so a bare
 * passthrough silently dropped it. Users got the scenario but no UI
 * launch.
 *
 * This wrapper intercepts `--run-ui` before forwarding to git-scenarios:
 *   - If present, it's replaced with the equivalent `--run "<spawn>"`
 *     where `<spawn>` is `tsx <coco-root>/src/index.ts ui`. The repo
 *     root is computed relative to this script so the wrapper works
 *     whether invoked via `npm run scenario`, a yarn alias, or
 *     directly via `tsx bin/scenarioRunner.ts ...`.
 *   - If absent, every other arg passes through unchanged. The wrapper
 *     adds no behavior to the base CLI in that case.
 *
 * The wrapper does NOT shell out — it spawns the git-scenarios CLI
 * directly so signal handling (Ctrl+C, exit code) propagates cleanly.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { rewriteRunUi } from './scenarioRunner/runUiFlag'

function repoRootFromHere(scriptUrl: string): string {
  // Resolve `<repo>/bin/scenarioRunner.ts` → `<repo>` regardless of how
  // the script was invoked. `import.meta.url` is the file URL of this
  // script; `fileURLToPath` gives us the absolute path on disk.
  const here = path.dirname(fileURLToPath(scriptUrl))
  return path.resolve(here, '..')
}

function main(): void {
  const root = repoRootFromHere(import.meta.url)
  const forwardedArgs = rewriteRunUi(process.argv.slice(2), root)

  // Resolve the git-scenarios CLI binary by reading its package.json
  // off disk and following the `bin.git-scenarios` entry. We
  // deliberately don't use require.resolve here — the package's
  // `exports` field doesn't expose `./package.json` or `./dist/bin/cli.js`,
  // so resolver-based lookup fails. Reading the file directly is
  // both simpler and more robust.
  //
  // The package directory itself is found relative to this script:
  // `<coco>/bin/scenarioRunner.ts` → `<coco>/node_modules/@gfargo/git-scenarios`.
  // Walking up via `path.join(root, 'node_modules', '...')` keeps the
  // resolution under our control rather than at the mercy of any
  // ambient PATH state.
  const pkgDir = path.join(root, 'node_modules', '@gfargo', 'git-scenarios')
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) {
    console.error(`@gfargo/git-scenarios not installed at ${pkgDir}. Run \`yarn install\` first.`)
    process.exit(1)
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: Record<string, string> | string
  }
  const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['git-scenarios']
  if (!binEntry) {
    console.error('Could not locate @gfargo/git-scenarios CLI binary in package.json `bin` field.')
    process.exit(1)
  }
  const cliBin = path.resolve(pkgDir, binEntry)

  const child = spawn(process.execPath, [cliBin, ...forwardedArgs], {
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      // Propagate the originating signal so a Ctrl+C in the wrapper
      // doesn't look like a clean exit upstream.
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

// Only spawn when invoked directly. Imports (e.g. tests around the
// pure rewriteRunUi helper) get the exports without firing the CLI.
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main()
}
