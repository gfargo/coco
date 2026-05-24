import {
  DEFAULT_STREAMING_PREVIEW_LINES,
  formatStreamingPreview,
  streamingPreviewTruncateMarker,
  STREAMING_PREVIEW_TRUNCATE_ASCII,
  STREAMING_PREVIEW_TRUNCATE_GLYPH,
} from './streamingPreview'

describe('formatStreamingPreview', () => {
  it('returns an empty view for undefined / empty / whitespace-only input', () => {
    // Renderers branch on `lines.length === 0` to skip the preview
    // entirely during the brief window between `setLoading(true)` and
    // the first chunk arriving. The helper must produce that empty
    // shape for every "nothing to show yet" case.
    expect(formatStreamingPreview(undefined, 40).lines).toEqual([])
    expect(formatStreamingPreview('', 40).lines).toEqual([])
    expect(formatStreamingPreview('   \n  \n', 40).lines).toEqual([])
    expect(formatStreamingPreview(undefined, 40).truncated).toBe(false)
  })

  it('returns the full wrapped lines without truncation when the buffer fits', () => {
    const view = formatStreamingPreview('Hello, world.\nGoodbye.', 40)
    expect(view.lines).toEqual(['Hello, world.', 'Goodbye.'])
    expect(view.truncated).toBe(false)
  })

  it('wraps long source lines to the supplied width', () => {
    // Width 10 forces a single ~30-char line to wrap. The exact wrap
    // points depend on `wrapCells`'s word-boundary logic; we only
    // assert that nothing comes back longer than the width.
    const view = formatStreamingPreview('the quick brown fox jumps over the lazy dog', 10)
    expect(view.lines.length).toBeGreaterThan(1)
    for (const line of view.lines) {
      // visual length, not strict char count — wrapCells handles wide
      // glyphs; ASCII tests can use length safely.
      expect(line.length).toBeLessThanOrEqual(10)
    }
  })

  it('returns only the trailing maxLines lines and flags truncation when wrapped output overflows', () => {
    // Eight source lines, budget of three. Helper should keep the
    // last three and report truncation so the renderer can prefix
    // the first visible line with an ellipsis marker.
    const buffer = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8'].join('\n')
    const view = formatStreamingPreview(buffer, 40, 3)
    expect(view.lines).toEqual(['line6', 'line7', 'line8'])
    expect(view.truncated).toBe(true)
  })

  it('preserves blank source lines so paragraph spacing survives the wrap', () => {
    // "A\n\nB" must render as ['A', '', 'B'], not ['A B'] or ['A', 'B'].
    // Paragraph spacing is part of the model's output rhythm; collapsing
    // it would make multi-paragraph commit bodies look like one
    // run-on blob.
    const view = formatStreamingPreview('A\n\nB', 40)
    expect(view.lines).toEqual(['A', '', 'B'])
    expect(view.truncated).toBe(false)
  })

  it('uses DEFAULT_STREAMING_PREVIEW_LINES when maxLines omitted', () => {
    // Build a buffer with exactly (default + 2) lines so we can verify
    // the helper's default budget without hard-coding the number.
    const total = DEFAULT_STREAMING_PREVIEW_LINES + 2
    const buffer = Array.from({ length: total }, (_, i) => `line${i + 1}`).join('\n')
    const view = formatStreamingPreview(buffer, 40)
    expect(view.lines).toHaveLength(DEFAULT_STREAMING_PREVIEW_LINES)
    expect(view.truncated).toBe(true)
    // First visible line is the third source line (lines 1+2 elided).
    expect(view.lines[0]).toBe('line3')
  })

  it('clamps an absurdly small maxLines to 1 instead of zero / negative', () => {
    // Defensive: a misconfigured caller passing maxLines=0 used to
    // return an empty preview even when the buffer had content,
    // making the preview vanish on small terminals. The helper now
    // clamps to a minimum of 1.
    const view = formatStreamingPreview('a\nb\nc', 40, 0)
    expect(view.lines).toEqual(['c'])
    expect(view.truncated).toBe(true)
  })

  it('clamps an absurdly small width to a sane minimum', () => {
    // Width values below 8 used to feed wrapCells a width that produced
    // empty segments or infinite loops. The helper floors to a minimum
    // wrap width so callers on narrow terminals still get readable
    // output (even if the wrap is aggressive).
    const view = formatStreamingPreview('hello there friend', 2)
    expect(view.lines.length).toBeGreaterThan(0)
    expect(view.lines.join(' ')).toContain('hello')
  })
})

describe('streamingPreviewTruncateMarker', () => {
  it('returns the unicode ellipsis for non-ASCII themes', () => {
    expect(streamingPreviewTruncateMarker(false)).toBe(STREAMING_PREVIEW_TRUNCATE_GLYPH)
    // Sanity: the glyph should be the single-character ellipsis, not
    // three periods. ASCII fallback covers the three-period case.
    expect(STREAMING_PREVIEW_TRUNCATE_GLYPH).toBe('…')
  })

  it('returns three periods for ASCII themes', () => {
    expect(streamingPreviewTruncateMarker(true)).toBe(STREAMING_PREVIEW_TRUNCATE_ASCII)
    expect(STREAMING_PREVIEW_TRUNCATE_ASCII).toBe('...')
  })
})
