#!/usr/bin/env node
/**
 * Bundle tree-sitter `.wasm` files into the distribution (#933 phase 1.1).
 *
 * Runs as a postbuild step. Copies the bundled language parsers and the
 * web-tree-sitter engine WASM from `node_modules/` (where they ship with
 * their respective packages) into `dist/tree-sitter/` so the published
 * npm tarball carries them. Runtime resolution in
 * `src/lib/parsers/default/__tree_sitter__/runtime.ts` finds them
 * relative to the running module's `__dirname`.
 *
 * Why a postbuild script instead of a rollup plugin: rollup is set up
 * to bundle JS only; static assets like WASM are simpler to copy with
 * a plain Node script than to wire through the plugin pipeline. The
 * script lives in `bin/` next to the other CLI / build helpers.
 *
 * Languages bundled (phase 1.1):
 *   - tree-sitter-typescript.wasm  (TS + TSX)
 *   - tree-sitter-tsx.wasm
 *   - web-tree-sitter.wasm         (the engine itself)
 *
 * JavaScript joins in phase 2; Python / Rust / Go ship via the lazy-
 * load infrastructure in phase 3+ (no bundle step).
 */

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const targetDir = join(projectRoot, 'dist', 'tree-sitter')

// Each entry: [source path relative to project root, destination filename]
// The destination keeps the package's filename so runtime resolution
// matches what web-tree-sitter expects for the engine WASM
// (`web-tree-sitter.wasm` lives next to the JS module by default).
const wasmFiles = [
  ['node_modules/web-tree-sitter/web-tree-sitter.wasm', 'web-tree-sitter.wasm'],
  ['node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm', 'tree-sitter-typescript.wasm'],
  ['node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm', 'tree-sitter-tsx.wasm'],
]

mkdirSync(targetDir, { recursive: true })

let copied = 0
let totalBytes = 0
for (const [srcRel, destName] of wasmFiles) {
  const src = join(projectRoot, srcRel)
  const dest = join(targetDir, destName)
  if (!existsSync(src)) {
    console.error(`! missing tree-sitter WASM source: ${srcRel}`)
    process.exit(1)
  }
  copyFileSync(src, dest)
  totalBytes += statSync(dest).size
  copied += 1
}

const mb = (totalBytes / (1024 * 1024)).toFixed(2)
console.log(`✓ copied ${copied} tree-sitter .wasm file(s) to dist/tree-sitter/ (${mb} MB total)`)
