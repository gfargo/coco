import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Rust structural fast path (#883, phase 2).
 *
 * Recognizes top-level / impl-block-level declarations: fn, struct,
 * enum, trait, impl, type aliases, pub const / pub static. The
 * "exported" flag tracks `pub` visibility — Rust's primary public
 * surface marker.
 *
 * Indentation in Rust isn't load-bearing, but real-world rustfmt
 * output keeps `impl` blocks and free fns at column 0 / 4 (one
 * level inside a module). We accept up to 4 spaces of leading
 * indent so the common rustfmt patterns get caught; anything
 * deeper is almost certainly inside a body.
 */

const RUST_EXTENSIONS = ['.rs']

export function isRustFile(path: string): boolean {
  const lower = path.toLowerCase()
  return RUST_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseRustStructuralLine(line: string): StructuralSymbol | undefined {
  // Up to 4 spaces of indent accepted — see header comment. Tabs
  // are rarer in Rust but we accept one if present.
  const trimmed = line.replace(/^[ \t]{0,4}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  let body = trimmed
  let exported = false
  // `pub(crate)`, `pub(super)`, `pub(in path)` — all visibility-
  // modifier forms count as "exported" for our purposes.
  const pubMatch = body.match(/^pub(?:\([^)]+\))?\s+/)
  if (pubMatch) {
    exported = true
    body = body.slice(pubMatch[0].length)
  }
  // Skip `unsafe` / `async` / `extern "C"` / `const` modifiers
  // ahead of fn so the fn matcher gets the bare keyword. Order
  // matters: `const fn` is a const-eval function.
  body = body.replace(/^(?:unsafe\s+)?(?:async\s+)?(?:extern\s+"[^"]*"\s+)?/, '')

  // const fn / async fn / unsafe fn — match the fn after the
  // modifier strip above.
  const fnMatch = body.match(/^(?:const\s+)?fn\s+([A-Za-z_][\w]*)/)
  if (fnMatch) return { name: fnMatch[1], kind: 'function', exported }

  const structMatch = body.match(/^struct\s+([A-Za-z_][\w]*)/)
  if (structMatch) return { name: structMatch[1], kind: 'class', exported }

  const enumMatch = body.match(/^enum\s+([A-Za-z_][\w]*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  const traitMatch = body.match(/^trait\s+([A-Za-z_][\w]*)/)
  if (traitMatch) return { name: traitMatch[1], kind: 'trait', exported }

  // `impl Trait for Type` and `impl Type` — surface the impl block
  // header so the user sees which type's surface area changed. The
  // shared renderer formats `impl X` with the kind label.
  const implMatch = body.match(/^impl(?:\s*<[^>]+>)?\s+(?:(\w[\w:<>]*)\s+for\s+)?([A-Za-z_][\w:<>]*)/)
  if (implMatch) {
    const traitName = implMatch[1]
    const typeName = implMatch[2]
    const display = traitName ? `${traitName} for ${typeName}` : typeName
    return { name: display, kind: 'impl', exported }
  }

  const typeMatch = body.match(/^type\s+([A-Za-z_][\w]*)\s*[=<]/)
  if (typeMatch) return { name: typeMatch[1], kind: 'type', exported }

  const constMatch = body.match(/^(?:const|static)\s+([A-Z_][A-Z0-9_]*)\s*:/)
  if (constMatch) return { name: constMatch[1], kind: 'const', exported }

  // `mod foo;` / `mod foo { ... }` at module scope. Submodules are
  // load-bearing structural signals in Rust crates.
  const modMatch = body.match(/^mod\s+([A-Za-z_][\w]*)\s*[;{]/)
  if (modMatch) return { name: modMatch[1], kind: 'module', exported }

  return undefined
}

export function summarizeRustStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isRustFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Rust',
    parseLine: parseRustStructuralLine,
  })
}
