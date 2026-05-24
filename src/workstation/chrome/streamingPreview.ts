/**
 * Streaming-preview helper (#881 phase 2). Turns the raw accumulated
 * text from an in-flight LLM stream into the last N visual lines that
 * fit a given panel width, plus a flag telling the renderer whether
 * earlier content was elided.
 *
 * Why a chrome helper instead of inlining the math in the compose
 * surface: the same shape is going to be reused by PR-body and review
 * streaming once those surfaces opt in. The visual line math (wrap to
 * width, count from the bottom, mark truncation) doesn't belong on the
 * surface itself.
 *
 * No JSX / no Ink here — chrome modules stay framework-agnostic and
 * return data the surface can hand to its own `h(Text, ...)` calls.
 */
import { wrapCells } from './text'

/**
 * Default last-N visible visual lines. Tuned for compose where the
 * panel already shows summary + body + loading line, so the preview
 * can't take more vertical space without pushing the state-line off
 * the bottom of short terminals. 6 lines is roughly two short
 * commit-body paragraphs — enough to feel like content is flowing,
 * not so much that the user loses sight of the surrounding chrome.
 */
export const DEFAULT_STREAMING_PREVIEW_LINES = 6

/**
 * Marker prefixed to the first visible line when earlier content was
 * elided. Chrome theme picks ASCII vs Unicode at render time; this
 * module returns both so surfaces don't need to import the theme.
 */
export const STREAMING_PREVIEW_TRUNCATE_GLYPH = '…'
export const STREAMING_PREVIEW_TRUNCATE_ASCII = '...'

export interface StreamingPreviewView {
  /**
   * The trailing visual lines that fit the (width, maxLines) budget,
   * already wrapped to the panel width. Empty array when the input is
   * empty / whitespace-only.
   */
  lines: string[]
  /**
   * True when the accumulated text produced more wrapped lines than
   * the budget allowed and the leading lines were dropped. Renderers
   * should prefix the first visible line with the truncation marker
   * when this is true.
   */
  truncated: boolean
}

/**
 * Compute the visible preview window for a streaming buffer.
 *
 * The buffer is split on newlines (preserving blank lines so paragraph
 * spacing stays visible), each source line is hard-wrapped to `width`,
 * and the trailing `maxLines` wrapped lines are returned. When the
 * total wrapped line count exceeds `maxLines`, `truncated` is true so
 * the renderer can prefix the first line with an ellipsis marker.
 *
 * Whitespace-only / empty input returns `{ lines: [], truncated: false }`
 * so renderers can branch on `lines.length === 0` to skip rendering
 * entirely during the brief window between dispatching `setLoading`
 * and the first chunk arriving.
 *
 * Width math mirrors the compose surface's body wrap (`width - 6` for
 * border + paddingX + 2-space indent budget); callers pass the width
 * they intend to use and this helper assumes it's the wrap budget,
 * not the panel width.
 */
export function formatStreamingPreview(
  accumulated: string | undefined,
  width: number,
  maxLines: number = DEFAULT_STREAMING_PREVIEW_LINES,
): StreamingPreviewView {
  if (!accumulated) {
    return { lines: [], truncated: false }
  }
  const trimmed = accumulated.replace(/\s+$/u, '')
  if (!trimmed) {
    return { lines: [], truncated: false }
  }

  // Wrap each source line. Empty source lines must survive the wrap so
  // a stream like "A\n\nB" reads as two paragraphs separated by a blank
  // row rather than collapsing into "A B".
  const wrapWidth = Math.max(8, width)
  const wrapped: string[] = []
  for (const line of trimmed.split('\n')) {
    if (line === '') {
      wrapped.push('')
      continue
    }
    for (const segment of wrapCells(line, wrapWidth)) {
      wrapped.push(segment)
    }
  }

  const budget = Math.max(1, maxLines)
  if (wrapped.length <= budget) {
    return { lines: wrapped, truncated: false }
  }
  return {
    lines: wrapped.slice(wrapped.length - budget),
    truncated: true,
  }
}

/**
 * Resolve the truncation marker for the current theme. Pure helper so
 * the surface can render a single-character glyph in colour terminals
 * and the ASCII fallback when `theme.ascii` is on. Centralised here so
 * future surfaces opting into streaming use the same glyph.
 */
export function streamingPreviewTruncateMarker(ascii: boolean): string {
  return ascii ? STREAMING_PREVIEW_TRUNCATE_ASCII : STREAMING_PREVIEW_TRUNCATE_GLYPH
}
