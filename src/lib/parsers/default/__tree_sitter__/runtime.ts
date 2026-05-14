/**
 * web-tree-sitter runtime wrapper (#933 phase 1.1).
 *
 * Owns the engine lifecycle (one-time `Parser.init`) and the
 * loaded-language cache (one `Language` per .wasm file, kept alive
 * for the process). Consumers (the per-language `StructuralParser`
 * implementations) ask for a parser via `getParser(language)` and
 * get back a `{ parser, language }` pair ready to call `parse()` on,
 * OR `undefined` when the .wasm files aren't available (dev mode
 * before postbuild has run, or a future test runner) — letting the
 * caller surrender to the regex parser in the registry chain.
 *
 * Path resolution: tree-sitter .wasm files are copied into
 * `dist/tree-sitter/` by the `copyTreeSitterWasm.mjs` postbuild
 * script. In a built dist this module sits at
 * `dist/index.js` (rolled-up bundle), so the .wasm directory is
 * one level down: `dist/tree-sitter/<lang>.wasm`. In dev (`tsx`
 * running source files directly), the same relative layout works
 * because tsx executes from the project root and `dist/tree-sitter`
 * is the only known location either way.
 *
 * Lazy + memoized: the first call pays init + load; subsequent
 * calls are free. Failure on first call (missing .wasm,
 * Parser.init throws, etc.) caches the failure so we don't retry
 * on every diff — the regex fallback is the correct steady state
 * in that case.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Dynamic-import shim. `web-tree-sitter` is `"type": "module"` (pure
 * ESM); a bare `await import('web-tree-sitter')` gets rewritten by
 * ts-jest's CJS transform into `await require('web-tree-sitter')`,
 * which fails because `require()` can't load ESM-only packages.
 * The `Function` constructor wraps the dynamic import in a string
 * body that survives TS compilation untouched, so the actual
 * `import()` call runs at runtime as native ESM dynamic import.
 *
 * Mirrors the pattern in `src/commands/log/inkRuntime.ts` and
 * `src/lib/ui/inquirerPrompts.ts` — the codebase's standard escape
 * hatch for ESM-only deps.
 */
type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

/**
 * Language identifiers this runtime knows how to load. Mirrors the
 * .wasm files copied into `dist/tree-sitter/` by the postbuild
 * script. Adding a language: drop the .wasm into the postbuild
 * file list, add an entry here, then build a `<Lang>StructuralParser`
 * against the runtime.
 */
export type TreeSitterLanguageId = 'typescript' | 'tsx'

type ResolvedWasmLocations = {
  enginePath: string
  languagePaths: Record<TreeSitterLanguageId, string>
}

/**
 * Locate the bundled .wasm files. Tries the dist layout first (the
 * common case for installed packages), then falls back to the
 * dev layout (running from source via tsx / ts-jest). Returns
 * undefined when neither contains the engine .wasm — caller
 * surrenders.
 *
 * Dual-format note: this module is bundled into BOTH the CJS output
 * (`dist/index.js`) and the ESM output (`dist/index.esm.mjs`). We
 * use `__dirname` at the source level because:
 *   - CJS bundle: `__dirname` is a built-in.
 *   - ESM bundle: rollup's `output.intro` for the .mjs target
 *     injects a shim deriving `__dirname` from `import.meta.url`
 *     (see rollup.config.mjs). Source code stays format-agnostic.
 *   - ts-jest tests: compiled to CJS, `__dirname` is a built-in.
 *   - tsx dev mode: tsx provides `__dirname` as a shim.
 */
function resolveWasmLocations(): ResolvedWasmLocations | undefined {
  const here = __dirname

  // Candidates in priority order. Each is a directory expected to
  // contain `web-tree-sitter.wasm` + the language .wasm files.
  // The dist layout is what `npm install -g coco` produces; the
  // dev layout is what `npm run dev` / `tsx` / `ts-jest` runs
  // against (resolving from the source module location).
  const candidates: string[] = [
    // Built dist: `dist/index.js` (or `dist/index.esm.mjs`) →
    // `dist/tree-sitter/`
    join(here, 'tree-sitter'),
    // Dev layout (source running via tsx / ts-jest):
    // `src/lib/parsers/default/__tree_sitter__/runtime.ts` →
    // project root + `dist/tree-sitter/`
    join(here, '..', '..', '..', '..', '..', 'dist', 'tree-sitter'),
  ]

  for (const dir of candidates) {
    const enginePath = join(dir, 'web-tree-sitter.wasm')
    if (!existsSync(enginePath)) continue
    return {
      enginePath,
      languagePaths: {
        typescript: join(dir, 'tree-sitter-typescript.wasm'),
        tsx: join(dir, 'tree-sitter-tsx.wasm'),
      },
    }
  }
  return undefined
}

// Memoized init promise. Either resolves with the loaded module
// surface or with `undefined` (a sentinel meaning "tree-sitter
// isn't available; use the fallback"). The promise itself is
// cached, so concurrent callers share the same init.
let initPromise: Promise<TreeSitterRuntime | undefined> | undefined

export type TreeSitterRuntime = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Parser: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Language: any
  locations: ResolvedWasmLocations
}

async function ensureRuntime(): Promise<TreeSitterRuntime | undefined> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const locations = resolveWasmLocations()
    if (!locations) return undefined

    let mod: { Parser: { init(opts?: unknown): Promise<void> }; Language: unknown }
    try {
      mod = await dynamicImport<{
        Parser: { init(opts?: unknown): Promise<void> }
        Language: unknown
      }>('web-tree-sitter')
    } catch {
      return undefined
    }

    try {
      // `locateFile` is the Emscripten hook that web-tree-sitter
      // uses to find its own engine .wasm. By default it looks
      // next to the JS module; we override so the dist layout
      // (`dist/tree-sitter/web-tree-sitter.wasm`) is honored.
      await mod.Parser.init({
        locateFile: (file: string) => {
          if (file.endsWith('.wasm')) return locations.enginePath
          return file
        },
      })
    } catch {
      return undefined
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Parser: (mod as any).Parser,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Language: (mod as any).Language,
      locations,
    }
  })()
  return initPromise
}

// Per-language Parser cache. Keyed on language id; reused for the
// life of the process. Parsers are stateless w.r.t. previous
// parses, so sharing a single instance per language is safe.
const parserCache = new Map<TreeSitterLanguageId, unknown>()

export type LoadedParser = {
  /** A `web-tree-sitter` Parser instance with the language attached. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: any
  language: TreeSitterLanguageId
}

/**
 * Return a parser ready to parse the given language's source. The
 * first call per-language pays the language .wasm load cost
 * (~15ms); subsequent calls are free. Returns undefined when the
 * .wasm files aren't available — callers surrender to the regex
 * parser in the registry chain.
 *
 * Errors during load are swallowed and cached as "unavailable"
 * for THIS language; other languages can still load independently.
 */
export async function getTreeSitterParser(
  language: TreeSitterLanguageId,
): Promise<LoadedParser | undefined> {
  const runtime = await ensureRuntime()
  if (!runtime) return undefined

  const cached = parserCache.get(language)
  if (cached) {
    return { parser: cached, language }
  }

  const langWasmPath = runtime.locations.languagePaths[language]
  if (!existsSync(langWasmPath)) {
    parserCache.set(language, undefined as never)
    return undefined
  }

  try {
    const lang = await runtime.Language.load(langWasmPath)
    const parser = new runtime.Parser()
    parser.setLanguage(lang)
    parserCache.set(language, parser)
    return { parser, language }
  } catch {
    parserCache.set(language, undefined as never)
    return undefined
  }
}

/**
 * Test seam — resets all memoized state so a test can simulate
 * fresh init / load. NOT a public API.
 */
export function _resetTreeSitterRuntimeForTesting(): void {
  initPromise = undefined
  parserCache.clear()
}
