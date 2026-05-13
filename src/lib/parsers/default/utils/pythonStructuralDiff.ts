import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Python structural fast path (#883, phase 2).
 *
 * Mirrors the TS extractor: recognize module-level declarations
 * (def, class, type aliases via `T = …`) and emit a templated
 * summary when a diff names at least one of them.
 *
 * Python's indentation-as-syntax makes "top-level" cheap to check:
 * a declaration at column 0 is module-scope; anything indented is
 * inside a block (class body, function body) and we leave it for
 * the LLM. Decorators belong to the following def — we recognize
 * them as a soft signal and attribute the symbol to its decorated
 * name on the next non-decorator line. For simplicity (and because
 * the per-line parser is stateless), we just skip decorator lines
 * and let the def below them carry the signal.
 */

const PYTHON_EXTENSIONS = ['.py', '.pyi']

export function isPythonFile(path: string): boolean {
  const lower = path.toLowerCase()
  return PYTHON_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parsePythonStructuralLine(line: string): StructuralSymbol | undefined {
  // Module-scope only — Python indents matter. Strip a single
  // leading space (the diff's column-0 alignment) and reject any
  // further indentation. `\t` at the start of a real line is also
  // a non-module-scope signal.
  if (line.startsWith('\t')) return undefined
  const trimmed = line.replace(/^ /, '')
  if (trimmed.startsWith(' ') || trimmed.startsWith('\t')) return undefined

  // Decorator line. The next def/class line carries the actual
  // symbol; without state we can't promote the decorator into a
  // symbol of its own, so skip.
  if (trimmed.startsWith('@')) return undefined

  // def / async def
  const fnMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/)
  if (fnMatch) {
    return { name: fnMatch[1], kind: 'function', exported: !fnMatch[1].startsWith('_') }
  }

  // class
  const classMatch = trimmed.match(/^class\s+([A-Za-z_][\w]*)/)
  if (classMatch) {
    return { name: classMatch[1], kind: 'class', exported: !classMatch[1].startsWith('_') }
  }

  // Module-level type alias (PEP 695: `type Name = ...`)
  const pep695Match = trimmed.match(/^type\s+([A-Za-z_][\w]*)\s*=/)
  if (pep695Match) {
    return { name: pep695Match[1], kind: 'type', exported: !pep695Match[1].startsWith('_') }
  }

  // Module-level CONSTANTS or annotated assignments. Restrict to
  // ALL_CAPS identifiers — module-level lowercase assignments are
  // common (config dicts, etc.) and surfacing them all would be
  // noisy. ALL_CAPS is the Python convention for "this is a
  // named module-level value worth flagging".
  const constMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*(?::|=[^=])/)
  if (constMatch) {
    return { name: constMatch[1], kind: 'const', exported: true }
  }

  return undefined
}

export function summarizePythonStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isPythonFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Python',
    parseLine: parsePythonStructuralLine,
  })
}
