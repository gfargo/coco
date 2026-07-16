import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FileDiff } from '../../../types'
import { treeSitterTsParser } from './tsTreeSitterParser'

function fileDiff(file: string, diff: string): FileDiff {
  return { file, diff, summary: '', tokenCount: Math.ceil(diff.length / 4) }
}

// Tree-sitter integration tests need the .wasm files copied to
// `dist/tree-sitter/` to actually exercise the code path. The
// `pretest:jest` npm script handles that automatically by running the
// postbuild copy step. ESM dynamic import (required to load
// `web-tree-sitter`, which is `"type": "module"`) works out of the box
// because `test:jest` runs with `NODE_OPTIONS=--experimental-vm-modules`
// (#933 phase 2).
//
// The wasm-available check stays as a defensive guard: if someone
// invokes `npx jest` directly without running `pretest:jest` first, the
// wasms won't be there. Skipping in that case keeps the runner honest
// about what was actually exercised, and the production code path
// (regex fallback) is still tested via the registry-level tests in
// `structuralParserRegistry.test.ts`.
const wasmDir = join(__dirname, '..', '..', '..', '..', '..', 'dist', 'tree-sitter')
const wasmAvailable = existsSync(join(wasmDir, 'web-tree-sitter.wasm')) &&
  existsSync(join(wasmDir, 'tree-sitter-typescript.wasm')) &&
  existsSync(join(wasmDir, 'tree-sitter-tsx.wasm'))

const describeWithWasm = wasmAvailable ? describe : describe.skip

describeWithWasm('treeSitterTsParser (.wasm-backed)', () => {
  // Note: deliberately NO `beforeEach` reset of the runtime. The runtime
  // is designed as process-lifetime (one init + one parser cache for the
  // whole run), and resetting between tests has caused flakes under
  // jest + ESM dynamic imports — a previous test file's teardown could
  // race the init promise. The init failure path is now retry-friendly
  // (see `ensureRuntime` in runtime.ts), and we trust the first test in
  // this suite to exercise the init path cleanly.

  it('returns undefined for non-TS / non-JS file paths', async () => {
    expect(await treeSitterTsParser.summarize(fileDiff('README.md', '+x'))).toBeUndefined()
    expect(await treeSitterTsParser.summarize(fileDiff('lib.rs', '+pub fn foo() {}'))).toBeUndefined()
  })

  it('names a top-level export function (matches regex output)', async () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-export function legacyParse() {}',
      '+export function parseRequest(input: string) {}',
    ].join('\n')
    const out = await treeSitterTsParser.summarize(fileDiff('src/p.ts', diff)) || ''
    expect(out).toContain('Updated TypeScript `src/p.ts`')
    expect(out).toContain('parseRequest()')
    expect(out).toContain('legacyParse()')
    // This is the first test in the suite that actually reaches
    // `getTreeSitterParser` (the .md/.rs cases above short-circuit
    // before touching the runtime), so it pays the one-time WASM
    // cold-init cost. That's occasionally >5s on a loaded macOS CI
    // runner — bump this test's timeout rather than the suite's.
  }, 20000)

  it('classifies an arrow-function export as a function, not a const (regex miss)', async () => {
    // Regex extractor returns `const handler` for this line because
    // the const-with-arrow shape isn't classified as a function.
    // Tree-sitter sees the arrow_function in the declarator value
    // and classifies the binding as a function, producing `handler()`
    // in the summary instead.
    const diff = [
      '@@ -0,0 +1,1 @@',
      '+export const handler = (req: Request) => process(req)',
    ].join('\n')
    const out = await treeSitterTsParser.summarize(fileDiff('src/api.ts', diff)) || ''
    expect(out).toContain('Updated TypeScript `src/api.ts`')
    expect(out).toMatch(/handler\(\)/)
    expect(out).not.toMatch(/const handler/)
  })

  it('returns undefined for body-only edits (no structural signal)', async () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' export function compute(x: number) {',
      '-  return x * 2',
      '+  return x * 3',
      ' }',
    ].join('\n')
    expect(await treeSitterTsParser.summarize(fileDiff('src/util.ts', diff))).toBeUndefined()
  })

  it('handles TSX files via the tsx grammar', async () => {
    // The tsx grammar parses JSX cleanly. The regex extractor doesn't
    // recognize this as a top-level structural signal beyond the
    // function declaration itself; tree-sitter agrees on the
    // function name but won't trip on the JSX body.
    const diff = [
      '@@ -1,3 +1,3 @@',
      '-export function OldButton() { return <div>old</div> }',
      '+export function NewButton(props: Props) { return <button onClick={props.onClick}>{props.label}</button> }',
    ].join('\n')
    const out = await treeSitterTsParser.summarize(fileDiff('src/Button.tsx', diff)) || ''
    expect(out).toContain('Updated TypeScript `src/Button.tsx`')
    expect(out).toMatch(/NewButton\(\)/)
    expect(out).toMatch(/OldButton\(\)/)
  })

  it('catches class declarations and interfaces', async () => {
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+export class Widget {}',
      '+export interface Renderable {}',
      '+export type Handler = (req: Request) => Response',
    ].join('\n')
    const out = await treeSitterTsParser.summarize(fileDiff('src/api.ts', diff)) || ''
    expect(out).toMatch(/class Widget/)
    expect(out).toMatch(/interface Renderable/)
    expect(out).toMatch(/type Handler/)
  })

  it('ignores keywords inside string literals (regex false-positive case)', async () => {
    // The regex parser would NOT actually trip on this line (its
    // pattern requires a leading word boundary) but tree-sitter
    // guarantees correctness — this test pins the AST-awareness
    // expectation in place so future regex tweaks don't regress.
    const diff = [
      '@@ -0,0 +1,1 @@',
      '+const ban = "function exfiltrate() {}"',
    ].join('\n')
    const out = await treeSitterTsParser.summarize(fileDiff('src/x.ts', diff))
    // We expect either undefined (no top-level function detected)
    // or a `const ban` entry — we should NOT see an `exfiltrate()`
    // entry in the summary.
    if (out) expect(out).not.toContain('exfiltrate')
  })
})

describe('treeSitterTsParser (wasm-missing fallthrough)', () => {
  it('id is reported as tree-sitter regardless of runtime state', () => {
    expect(treeSitterTsParser.id).toBe('tree-sitter')
  })
})
