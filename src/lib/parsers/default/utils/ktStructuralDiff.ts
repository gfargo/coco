import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Kotlin structural fast path.
 *
 * Recognizes top-level declarations on a single line: `fun` (including
 * generic `fun <T> name(` and extension `fun Receiver.name(`), `class` /
 * `data class` / `sealed class` / `abstract class` / `open class`,
 * `enum class`, `interface` / `fun interface`, and named `object`s.
 *
 * Kotlin is public-by-default; we strip leading declaration modifiers and
 * mark `private` / `protected` / `internal` declarations `exported: false`
 * (cosmetic — the shared renderer doesn't surface it today, but it keeps
 * the symbol shape honest). Nuance beyond a single line (multi-line
 * signatures, nested locals) is left to the LLM fallback.
 *
 * Like the other regex parsers we accept up to ~8 spaces (2 indent levels)
 * of leading whitespace so nested members still register, and bail on
 * anything deeper.
 */

const KT_EXTENSIONS = ['.kt', '.kts']

// Leading declaration modifiers, stripped before matching the keyword.
// `enum` is intentionally absent — `enum class` is matched as a unit.
const KT_MODIFIER =
  /^(?:public|protected|private|internal|open|final|abstract|sealed|data|inner|annotation|value|companion|inline|infix|operator|suspend|external|override|lateinit|tailrec|expect|actual)\s+/

export function isKotlinFile(path: string): boolean {
  const lower = path.toLowerCase()
  return KT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseKotlinStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Strip leading modifiers, recording visibility.
  let body = trimmed
  let exported = true
  for (;;) {
    const m = body.match(KT_MODIFIER)
    if (!m) break
    if (/^(?:private|protected|internal)\b/.test(m[0])) exported = false
    body = body.slice(m[0].length)
  }

  // `enum class Name` — before the plain `class` matcher.
  const enumMatch = body.match(/^enum\s+class\s+([A-Za-z_]\w*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  // `interface Name` / `fun interface Name` (SAM) — before `fun`/`class`.
  const interfaceMatch = body.match(/^(?:fun\s+)?interface\s+([A-Za-z_]\w*)/)
  if (interfaceMatch) return { name: interfaceMatch[1], kind: 'interface', exported }

  // `class Name` (modifiers already stripped).
  const classMatch = body.match(/^class\s+([A-Za-z_]\w*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported }

  // Named `object Name` (singleton). Anonymous `companion object` has no
  // name and isn't worth reporting.
  const objectMatch = body.match(/^object\s+([A-Za-z_]\w*)/)
  if (objectMatch) return { name: objectMatch[1], kind: 'class', exported }

  // `fun name(` / `fun <T> name(` / `fun Receiver.name(`.
  const funMatch = body.match(
    /^fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*)\s*\(/
  )
  if (funMatch) return { name: funMatch[1], kind: 'function', exported }

  return undefined
}

export function summarizeKotlinStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isKotlinFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Kotlin',
    parseLine: parseKotlinStructuralLine,
  })
}
