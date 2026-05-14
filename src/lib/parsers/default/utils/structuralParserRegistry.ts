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
import { treeSitterGoParser } from '../__tree_sitter__/goTreeSitterParser'
import { treeSitterPythonParser } from '../__tree_sitter__/pythonTreeSitterParser'
import { treeSitterRustParser } from '../__tree_sitter__/rustTreeSitterParser'
import { treeSitterTsParser } from '../__tree_sitter__/tsTreeSitterParser'
import { summarizeGoStructuralDiff } from './goStructuralDiff'
import { summarizePythonStructuralDiff } from './pythonStructuralDiff'
import { summarizeRustStructuralDiff } from './rustStructuralDiff'
import { summarizeTsStructuralDiff } from './tsStructuralDiff'

/** Identifier reported by each parser for telemetry / debugging. */
export type StructuralParserKind = 'regex' | 'tree-sitter'

/** Language identifier used as the registry key. */
export type StructuralLanguageId = 'ts' | 'js' | 'py' | 'rs' | 'go'

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

/**
 * Per-language parser chains, in priority order. Tree-sitter is
 * preferred for `ts` and `js` (phase 1.1); when the .wasm files
 * aren't loaded the tree-sitter parser surrenders to the regex
 * parser without any caller-visible change. Lazy-loaded languages
 * (Python / Rust / Go) get their tree-sitter parsers prepended in
 * phase 4–6 as their lazy-load infrastructure lands.
 */
const REGISTRY: Record<StructuralLanguageId, StructuralParser[]> = {
  ts: [treeSitterTsParser, regexTs],
  js: [treeSitterTsParser, regexJs],
  py: [treeSitterPythonParser, regexPy],
  rs: [treeSitterRustParser, regexRs],
  go: [treeSitterGoParser, regexGo],
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
