import { FileDiff } from '../../../types'

/**
 * TypeScript / JavaScript structural fast path (#883, phase 1).
 *
 * Mirrors `summarizeMarkdownDiff` from #861 / angle 5: when a diff
 * has clear top-level symbol changes (added / removed / renamed
 * exports, functions, classes, interfaces, types), emit a templated
 * summary that names the changes instead of paying for an LLM call.
 *
 * Quality trade-off, on purpose: an LLM summary of a TS diff is
 * usually wordier ("refactored the parser to extract a helper")
 * but most of that detail isn't load-bearing for a commit message —
 * the structural skeleton ("added parseRequest, removed
 * legacyParse") is the part the model uses to write a useful subject
 * line. The structural extract names that skeleton in a fraction
 * of the tokens.
 *
 * This is a regex-first cut intended to ship as the foundation
 * for #883. Tree-sitter integration (which is per-language binary
 * weight of 200KB–2 MB) is a follow-up: it gives us scopes,
 * receiver types, signature deltas — better fidelity at higher
 * build cost. The current implementation catches the high-signal
 * cases (added / removed top-level symbols) and falls through to
 * the LLM when the diff has no structural signal so paragraph-only
 * / cosmetic changes keep their full-fidelity summary.
 *
 * Off by default. The user opts in via
 * `service.fastPath.languageAware: { enabled: true; languages: [...] }`.
 * Per the project convention (and the same logic that gated the
 * markdown fast path), lossy optimizations stay off by default.
 */

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs']
const MAX_SYMBOLS_PER_BUCKET = 8

export type StructuralLanguage = 'ts' | 'js'

export function detectStructuralLanguage(path: string): StructuralLanguage | undefined {
  const lower = path.toLowerCase()
  if (TS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'ts'
  if (JS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'js'
  return undefined
}

export type StructuralSymbol = {
  /**
   * Display name of the declared symbol. For multi-word forms
   * (e.g. `export default function foo`) only the identifier
   * itself is captured.
   */
  name: string
  /**
   * Coarse-grained kind. Used to group the summary buckets; not
   * structural beyond that.
   */
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'default'
  /** True when the declaration is `export`ed. */
  exported: boolean
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
  // Skip lines that look like they're inside a block (indented in
  // the source by anything other than the diff marker itself).
  const leadingIndent = line.length - trimmed.length
  if (leadingIndent > 1) return undefined

  let body = trimmed
  let exported = false
  if (body.startsWith('export ')) {
    exported = true
    body = body.slice('export '.length).trimStart()
  }

  // export default function foo(... | export default class Foo | export default <expression>
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

  // const / let / var with an identifier we can capture. Only the
  // first identifier — destructuring patterns at top level are
  // unusual and the LLM fallback can name them better than we can.
  const constMatch = body.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/)
  if (constMatch) return { name: constMatch[1], kind: 'const', exported }

  return undefined
}

export function summarizeTsStructuralDiff(fileDiff: FileDiff): string | undefined {
  const language = detectStructuralLanguage(fileDiff.file)
  if (!language) return undefined

  const added = new Map<string, StructuralSymbol>()
  const removed = new Map<string, StructuralSymbol>()
  let addedLines = 0
  let removedLines = 0

  for (const line of fileDiff.diff.split('\n')) {
    if (isPatchHeader(line)) continue
    if (line.startsWith('+')) {
      addedLines++
      const symbol = parseStructuralLine(line.slice(1))
      if (symbol) added.set(keyOf(symbol), symbol)
    } else if (line.startsWith('-')) {
      removedLines++
      const symbol = parseStructuralLine(line.slice(1))
      if (symbol) removed.set(keyOf(symbol), symbol)
    }
  }

  if (addedLines === 0 && removedLines === 0) return undefined

  // No structural signal → fall through to LLM. We only fast-path
  // when the diff names at least one top-level declaration; pure
  // body-edit / formatting changes keep their full-fidelity summary.
  if (added.size === 0 && removed.size === 0) return undefined

  // A symbol that appears in both buckets is likely a signature
  // change (kept around but its declaration line changed). Surface
  // these as "updated" so the user sees they aren't strictly
  // added/removed.
  const updatedKeys = new Set([...added.keys()].filter((k) => removed.has(k)))
  const pureAdded = [...added.values()].filter((s) => !updatedKeys.has(keyOf(s)))
  const pureRemoved = [...removed.values()].filter((s) => !updatedKeys.has(keyOf(s)))
  const updated = [...updatedKeys].map((k) => added.get(k) as StructuralSymbol)

  const parts: string[] = [`Updated ${language === 'ts' ? 'TypeScript' : 'JavaScript'} \`${fileDiff.file}\``]
  if (pureAdded.length) {
    parts.push(`added: ${formatSymbolList(pureAdded)}`)
  }
  if (pureRemoved.length) {
    parts.push(`removed: ${formatSymbolList(pureRemoved)}`)
  }
  if (updated.length) {
    parts.push(`signature change: ${formatSymbolList(updated)}`)
  }
  parts.push(`+${addedLines}/-${removedLines} lines`)

  return `${parts.join('. ')}.`
}

function isPatchHeader(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('Binary files ')
  )
}

function keyOf(symbol: StructuralSymbol): string {
  return `${symbol.kind}:${symbol.name}`
}

function formatSymbolList(symbols: StructuralSymbol[]): string {
  const labeled = symbols.map((s) => formatSymbol(s))
  if (labeled.length <= MAX_SYMBOLS_PER_BUCKET) return labeled.join(', ')
  const shown = labeled.slice(0, MAX_SYMBOLS_PER_BUCKET)
  const remainder = labeled.length - shown.length
  return `${shown.join(', ')} (+${remainder} more)`
}

function formatSymbol(symbol: StructuralSymbol): string {
  // Render `<kind> <name>` for non-functions to keep the summary
  // unambiguous. Functions are by far the most common; rendering
  // them as `name()` reads naturally inline.
  if (symbol.kind === 'function' || symbol.kind === 'default') {
    return `${symbol.name}()`
  }
  return `${symbol.kind} ${symbol.name}`
}
