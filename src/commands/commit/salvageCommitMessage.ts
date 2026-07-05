/**
 * Best-effort recovery of a `{ title, body }` commit message from raw LLM
 * text when the structured-output parser fails. Shared between the
 * non-streaming `executeChainWithSchema` fallback and the streaming path's
 * manual salvage attempt (#881 phase 2 / audit finding #1).
 */

function extractFencedJson(text: string): string | undefined {
  const match = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  return match?.[1]?.trim()
}

/**
 * Scan for the first `{` and walk forward tracking brace depth (respecting
 * quoted strings and escapes) until it finds the matching `}`. Recovers a
 * JSON object embedded anywhere in the text — prose prefix/suffix, or a
 * fenced block whose body contains a `}` that would truncate a non-greedy
 * regex match.
 */
function extractBalancedJson(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined

  let depth = 0
  let inString = false
  let escapeNext = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (inString) {
      if (char === '\\') {
        escapeNext = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return undefined
}

function tryParseCommitJson(candidate: string | undefined): { title: string; body: string } | undefined {
  if (!candidate) return undefined
  try {
    const parsed = JSON.parse(candidate)
    if (
      parsed && typeof parsed === 'object' &&
      typeof parsed.title === 'string' &&
      typeof parsed.body === 'string' &&
      parsed.title.length > 0
    ) {
      return { title: parsed.title, body: parsed.body }
    }
  } catch {
    // fall through to the next candidate
  }
  return undefined
}

/**
 * Recovers a commit message from raw LLM text in three passes: a fenced
 * ```json code block, a balanced-brace scan of the whole text (catches
 * prose-prefixed JSON and fence-truncation from nested `}`), and finally
 * "first line is title, rest is body" when no valid JSON can be found.
 */
export function salvageCommitMessageFromText(text: string): { title: string; body: string } {
  const trimmed = text.trim()

  const fromFence = tryParseCommitJson(extractFencedJson(trimmed))
  if (fromFence) return fromFence

  const fromBalanced = tryParseCommitJson(extractBalancedJson(trimmed))
  if (fromBalanced) return fromBalanced

  return {
    title: trimmed.split('\n')[0] || 'Auto-generated commit',
    body: trimmed.split('\n').slice(1).join('\n') || 'Generated commit message',
  }
}
