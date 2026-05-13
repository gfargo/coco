import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * TypeScript / JavaScript structural fast path (#883, phase 1).
 *
 * Mirrors `summarizeMarkdownDiff` from #861 / angle 5: when a diff
 * has clear top-level symbol changes (added / removed / renamed
 * exports, functions, classes, interfaces, types), emit a templated
 * summary that names the changes instead of paying for an LLM call.
 *
 * Phase 1 ships a regex-first extractor; per-language modules now
 * share the diff-walking + rendering scaffolding via
 * `structuralDiff.ts`. Each language module owns its per-line
 * recognition only.
 *
 * Off by default. The user opts in via
 * `service.fastPath.languageAware: { enabled: true; languages: [...] }`.
 * Per the project convention (and the same logic that gated the
 * markdown fast path), lossy optimizations stay off by default.
 */

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs']

export type TsLanguage = 'ts' | 'js'

/** @deprecated use {@link detectTsLanguage}. Retained for callers in tests. */
export function detectStructuralLanguage(path: string): TsLanguage | undefined {
  return detectTsLanguage(path)
}

export function detectTsLanguage(path: string): TsLanguage | undefined {
  const lower = path.toLowerCase()
  if (TS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'ts'
  if (JS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'js'
  return undefined
}

/**
 * Recognize top-level symbol declarations in a single source line.
 * Returns the matched symbol or undefined when the line isn't a
 * recognized declaration. Intentionally conservative: matches only
 * patterns that look like top-level declarations from a glance, so
 * we don't surface noise from a `function` keyword buried inside
 * another function body.
 *
 * Exported for direct testing — the extractor depends on this being
 * deterministic for individual line cases.
 */
export function parseStructuralLine(line: string): StructuralSymbol | undefined {
  // Strip the leading +/- and any single space of indent that git
  // diffs often emit. Anything beyond that level of indent isn't a
  // top-level declaration we care about.
  const trimmed = line.replace(/^\s+/, '')
  const leadingIndent = line.length - trimmed.length
  if (leadingIndent > 1) return undefined

  let body = trimmed
  let exported = false
  if (body.startsWith('export ')) {
    exported = true
    body = body.slice('export '.length).trimStart()
  }

  if (body.startsWith('default ')) {
    const rest = body.slice('default '.length).trimStart()
    const fnMatch = rest.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/)
    if (fnMatch) {
      return { name: fnMatch[1] || 'default', kind: 'default', exported: true }
    }
    const classMatch = rest.match(/^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
    if (classMatch) {
      return { name: classMatch[1], kind: 'default', exported: true }
    }
    return { name: 'default', kind: 'default', exported: true }
  }

  const fnMatch = body.match(/^(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/)
  if (fnMatch) return { name: fnMatch[1], kind: 'function', exported }

  const classMatch = body.match(/^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported }

  const interfaceMatch = body.match(/^interface\s+([A-Za-z_$][\w$]*)/)
  if (interfaceMatch) return { name: interfaceMatch[1], kind: 'interface', exported }

  const typeMatch = body.match(/^type\s+([A-Za-z_$][\w$]*)\s*[=<]/)
  if (typeMatch) return { name: typeMatch[1], kind: 'type', exported }

  const enumMatch = body.match(/^(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  const constMatch = body.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/)
  if (constMatch) return { name: constMatch[1], kind: 'const', exported }

  return undefined
}

export function summarizeTsStructuralDiff(fileDiff: FileDiff): string | undefined {
  const language = detectTsLanguage(fileDiff.file)
  if (!language) return undefined

  return summarizeStructuralDiff(fileDiff, {
    label: language === 'ts' ? 'TypeScript' : 'JavaScript',
    parseLine: parseStructuralLine,
  })
}
