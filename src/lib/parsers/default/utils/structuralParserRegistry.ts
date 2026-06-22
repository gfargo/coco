/**
 * Structural parser registry (#933 phase 1.0).
 *
 * Each language can have multiple parsers in priority order — e.g.
 * `[treeSitterTs, regexTs]` means "try tree-sitter first; if it
 * isn't available or it can't handle this diff shape, fall through
 * to the regex extractor". The dispatcher walks the list until one
 * returns a summary or the list is exhausted; on exhaustion the
 * file falls through to the LLM as before.
 *
 * This module is the foundation for the tree-sitter integration
 * landing in phase 1.1. Today every entry is a regex parser
 * wrapping the existing per-language summarizers — pure refactor,
 * zero behavior change. Phase 1.1 prepends the tree-sitter parser
 * for TS / JS without touching the rest of the call sites.
 *
 * Why a registry instead of a switch / dispatcher: the upgrade path
 * (regex → tree-sitter → tree-sitter-with-better-grammar) needs a
 * shape that supports "multiple parsers per language, tried in
 * order, with graceful fallback on error". Hard-coded dispatch
 * would need to grow `try { } catch { fallthrough }` branches in
 * every language case; the registry makes that part of the
 * iteration loop and keeps the per-language modules focused on
 * "given this diff, produce a summary".
 */

import type { FileDiff } from '../../../types'
import { treeSitterCCppParser } from '../__tree_sitter__/cCppTreeSitterParser'
import { treeSitterCsParser } from '../__tree_sitter__/csTreeSitterParser'
import { treeSitterGoParser } from '../__tree_sitter__/goTreeSitterParser'
import { treeSitterJavaParser } from '../__tree_sitter__/javaTreeSitterParser'
import { treeSitterPhpParser } from '../__tree_sitter__/phpTreeSitterParser'
import { treeSitterPythonParser } from '../__tree_sitter__/pythonTreeSitterParser'
import { treeSitterRubyParser } from '../__tree_sitter__/rubyTreeSitterParser'
import { treeSitterRustParser } from '../__tree_sitter__/rustTreeSitterParser'
import { treeSitterTsParser } from '../__tree_sitter__/tsTreeSitterParser'
import { summarizeBashStructuralDiff } from './bashStructuralDiff'
import { summarizeCppStructuralDiff } from './cppStructuralDiff'
import { summarizeCsStructuralDiff } from './csStructuralDiff'
import { summarizeGoStructuralDiff } from './goStructuralDiff'
import { summarizeJavaStructuralDiff } from './javaStructuralDiff'
import { summarizeKotlinStructuralDiff } from './ktStructuralDiff'
import { summarizeLuaStructuralDiff } from './luaStructuralDiff'
import { summarizePhpStructuralDiff } from './phpStructuralDiff'
import { summarizePythonStructuralDiff } from './pythonStructuralDiff'
import { summarizeRubyStructuralDiff } from './rbStructuralDiff'
import { summarizeRustStructuralDiff } from './rustStructuralDiff'
import { summarizeSwiftStructuralDiff } from './swiftStructuralDiff'
import { summarizeTsStructuralDiff } from './tsStructuralDiff'

/** Identifier reported by each parser for telemetry / debugging. */
export type StructuralParserKind = 'regex' | 'tree-sitter'

/** Language identifier used as the registry key. */
export type StructuralLanguageId =
  | 'ts'
  | 'js'
  | 'py'
  | 'rs'
  | 'go'
  | 'java'
  | 'cpp'
  | 'cs'
  | 'rb'
  | 'php'
  | 'kt'
  | 'swift'
  | 'lua'
  | 'bash'

/**
 * A structural parser is a strategy for producing a templated
 * summary from a unified-diff `FileDiff`. Returns undefined when:
 *
 *   - The diff body is empty / unchanged
 *   - The diff has no recognizable structural signal (paragraph-
 *     only edits, body-only changes, etc.) — the LLM is the
 *     better summarizer for these
 *   - This parser specifically can't handle the input (e.g. tree-
 *     sitter parser not loaded yet, or the AST shape is something
 *     the extractor doesn't recognize)
 *
 * Returning undefined surrenders to the next parser in the
 * registry list; throwing also surrenders, with the error logged
 * for telemetry. The contract is "best-effort summary or surrender";
 * the caller composes the fallthrough chain.
 *
 * Sync OR async — tree-sitter parser init is async, but the regex
 * parsers are sync. The dispatcher awaits the result either way so
 * the per-parser signatures can match their actual cost model.
 */
export interface StructuralParser {
  readonly id: StructuralParserKind
  summarize(fileDiff: FileDiff): Promise<string | undefined> | string | undefined
}

/**
 * Regex-based parser shim. Adapts the existing per-language
 * `summarize*StructuralDiff` functions to the parser interface so
 * they can live in the registry alongside future tree-sitter
 * parsers. Stateless, no init cost, sync.
 */
function regexParser(
  summarize: (fileDiff: FileDiff) => string | undefined,
): StructuralParser {
  return {
    id: 'regex',
    summarize,
  }
}

const regexTs = regexParser(summarizeTsStructuralDiff)
const regexJs = regexTs   // same extractor; the language detector inside
                          // `summarizeTsStructuralDiff` accepts both
const regexPy = regexParser(summarizePythonStructuralDiff)
const regexRs = regexParser(summarizeRustStructuralDiff)
const regexGo = regexParser(summarizeGoStructuralDiff)
const regexJava = regexParser(summarizeJavaStructuralDiff)
const regexCpp = regexParser(summarizeCppStructuralDiff)
const regexCs = regexParser(summarizeCsStructuralDiff)
const regexRb = regexParser(summarizeRubyStructuralDiff)
const regexPhp = regexParser(summarizePhpStructuralDiff)
const regexKt = regexParser(summarizeKotlinStructuralDiff)
const regexSwift = regexParser(summarizeSwiftStructuralDiff)
const regexLua = regexParser(summarizeLuaStructuralDiff)
const regexBash = regexParser(summarizeBashStructuralDiff)

/**
 * Per-language parser chains, in priority order. Tree-sitter is
 * preferred when the .wasm is cached; the parser surrenders to the
 * regex fallback without any caller-visible change when it isn't.
 * Lazy-loaded languages (Java / C / C++ / C# / Ruby / PHP) added
 * in COCO-1239.
 */
const REGISTRY: Record<StructuralLanguageId, StructuralParser[]> = {
  ts: [treeSitterTsParser, regexTs],
  js: [treeSitterTsParser, regexJs],
  py: [treeSitterPythonParser, regexPy],
  rs: [treeSitterRustParser, regexRs],
  go: [treeSitterGoParser, regexGo],
  java: [treeSitterJavaParser, regexJava],
  cpp: [treeSitterCCppParser, regexCpp],
  cs: [treeSitterCsParser, regexCs],
  rb: [treeSitterRubyParser, regexRb],
  php: [treeSitterPhpParser, regexPhp],
  kt: [regexKt],
  swift: [regexSwift],
  lua: [regexLua],
  bash: [regexBash],
}

/**
 * Walk the parser chain for the given language and return the
 * first non-undefined summary. Errors thrown by any parser are
 * swallowed so the chain continues — telemetry hook is reserved
 * for phase 1.1+ where tree-sitter failures need observability.
 *
 * Exported as the single public entry point; consumers should not
 * read REGISTRY directly so the registry shape can evolve without
 * leaking to call sites.
 */
export async function dispatchStructuralParser(
  language: StructuralLanguageId,
  fileDiff: FileDiff,
): Promise<string | undefined> {
  const chain = REGISTRY[language]
  if (!chain) return undefined
  for (const parser of chain) {
    try {
      const result = await parser.summarize(fileDiff)
      if (result !== undefined) return result
    } catch {
      // Parser surrendered via throw. Continue to the next in the
      // chain. Phase 1.1 wires a logger hook here so tree-sitter
      // failures are observable without spamming the user.
    }
  }
  return undefined
}

/**
 * Test seam: returns a shallow snapshot of the per-language chain.
 * Used by registry-shape assertions in the eval / unit tests.
 * NOT a public API — phase 1.1 may rearrange the registry's
 * internal shape.
 */
export function _registrySnapshotForTesting(): Record<StructuralLanguageId, StructuralParserKind[]> {
  return Object.fromEntries(
    Object.entries(REGISTRY).map(([lang, chain]) => [lang, chain.map((p) => p.id)])
  ) as Record<StructuralLanguageId, StructuralParserKind[]>
}

/**
 * True when a given language's chain INCLUDES a tree-sitter parser.
 * Used by the LLM fallthrough path in `summarizeLargeFiles.ts` to
 * surface a discoverability hint ("run `coco cache prefetch py` to
 * enable tree-sitter") when the chain falls through entirely.
 *
 * Doesn't tell us WHY the tree-sitter parser surrendered — that's
 * still an internal concern of the parser itself (cache miss vs.
 * dynamic-import failure vs. AST shape unrecognized). The hint the
 * surface emits is generic enough to cover all of those cases.
 */
export function hasTreeSitterParser(language: StructuralLanguageId): boolean {
  const chain = REGISTRY[language]
  if (!chain) return false
  return chain.some((parser) => parser.id === 'tree-sitter')
}
