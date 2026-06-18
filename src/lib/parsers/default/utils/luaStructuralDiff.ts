import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Lua structural fast path.
 *
 * Lua has no classes — structure is just functions, declared a few ways:
 *   - `function name(...)` / `local function name(...)`
 *   - `function Table.name(...)` / `function Table:method(...)` (the
 *     qualified name is kept, e.g. `M.foo` / `M:bar`, since that's how the
 *     reader recognizes the member)
 *   - `name = function(...)` / `local name = function(...)` (assigned)
 *
 * `local` declarations are file-scoped, so we mark them `exported: false`
 * (cosmetic today). Anything not matching on a single line returns
 * undefined and falls through to the LLM. Up to ~8 spaces of leading
 * whitespace is accepted; deeper lines bail.
 */

const LUA_EXTENSIONS = ['.lua']

export function isLuaFile(path: string): boolean {
  const lower = path.toLowerCase()
  return LUA_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseLuaStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  const isLocal = /^local\s+/.test(trimmed)
  const exported = !isLocal

  // `function name(...)`, `local function name(...)`,
  // `function Table.name(...)`, `function Table:method(...)`.
  const fnMatch = trimmed.match(
    /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(/
  )
  if (fnMatch) return { name: fnMatch[1], kind: 'function', exported }

  // Assigned function expressions: `name = function(...)`,
  // `local name = function(...)`, `Table.name = function(...)`.
  const assignMatch = trimmed.match(
    /^(?:local\s+)?([A-Za-z_][\w.:]*)\s*=\s*function\s*\(/
  )
  if (assignMatch) return { name: assignMatch[1], kind: 'function', exported }

  return undefined
}

export function summarizeLuaStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isLuaFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Lua',
    parseLine: parseLuaStructuralLine,
  })
}
