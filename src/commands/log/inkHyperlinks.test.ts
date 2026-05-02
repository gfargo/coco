import { formatHyperlink, supportsHyperlinks } from './inkHyperlinks'

const OSC_8_OPEN = ']8;;'
const ST = '\\'

describe('log Ink hyperlinks (P5.1)', () => {
  describe('supportsHyperlinks', () => {
    it('returns true for kitty (TERM=xterm-kitty or KITTY_WINDOW_ID set)', () => {
      expect(supportsHyperlinks({ TERM: 'xterm-kitty' })).toBe(true)
      expect(supportsHyperlinks({ KITTY_WINDOW_ID: '1' })).toBe(true)
    })

    it('returns true for Windows Terminal (WT_SESSION set)', () => {
      expect(supportsHyperlinks({ WT_SESSION: 'abcd' })).toBe(true)
    })

    it('returns true for Ghostty (GHOSTTY_RESOURCES_DIR set or TERM_PROGRAM=ghostty)', () => {
      expect(supportsHyperlinks({ GHOSTTY_RESOURCES_DIR: '/x' })).toBe(true)
      expect(supportsHyperlinks({ TERM_PROGRAM: 'ghostty' })).toBe(true)
    })

    it('returns true for the curated TERM_PROGRAM list', () => {
      expect(supportsHyperlinks({ TERM_PROGRAM: 'iTerm.app' })).toBe(true)
      expect(supportsHyperlinks({ TERM_PROGRAM: 'WezTerm' })).toBe(true)
      expect(supportsHyperlinks({ TERM_PROGRAM: 'vscode' })).toBe(true)
      expect(supportsHyperlinks({ TERM_PROGRAM: 'mintty' })).toBe(true)
      expect(supportsHyperlinks({ TERM_PROGRAM: 'Hyper' })).toBe(true)
    })

    it('returns false for Apple Terminal and unknown terminals', () => {
      expect(supportsHyperlinks({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false)
      expect(supportsHyperlinks({})).toBe(false)
      expect(supportsHyperlinks({ TERM: 'screen' })).toBe(false)
    })

    it('honors NO_COLOR by suppressing hyperlinks', () => {
      expect(supportsHyperlinks({ NO_COLOR: '1', TERM_PROGRAM: 'iTerm.app' })).toBe(false)
    })

    it('lets FORCE_HYPERLINK override detection', () => {
      expect(supportsHyperlinks({ FORCE_HYPERLINK: '1' })).toBe(true)
      expect(supportsHyperlinks({ FORCE_HYPERLINK: '1', TERM_PROGRAM: 'Apple_Terminal' })).toBe(true)
      expect(supportsHyperlinks({ FORCE_HYPERLINK: '0', TERM_PROGRAM: 'iTerm.app' })).toBe(false)
    })
  })

  describe('formatHyperlink', () => {
    const supportingEnv = { TERM_PROGRAM: 'iTerm.app' }
    const plainEnv = { TERM_PROGRAM: 'Apple_Terminal' }

    it('wraps text in OSC 8 when the terminal supports hyperlinks', () => {
      const out = formatHyperlink('PR #738', 'https://github.com/owner/repo/pull/738', supportingEnv)
      expect(out).toBe(`${OSC_8_OPEN}https://github.com/owner/repo/pull/738${ST}PR #738${OSC_8_OPEN}${ST}`)
    })

    it('returns plain text when the terminal does not support hyperlinks', () => {
      expect(formatHyperlink('PR #738', 'https://github.com/owner/repo/pull/738', plainEnv))
        .toBe('PR #738')
    })

    it('returns plain text when the URL is missing or empty', () => {
      expect(formatHyperlink('abc1234', undefined, supportingEnv)).toBe('abc1234')
      expect(formatHyperlink('abc1234', '', supportingEnv)).toBe('abc1234')
    })

    it('preserves the original visible text content', () => {
      const out = formatHyperlink('main', 'https://example.com/main', supportingEnv)
      // The visible text (between the open OSC and the close OSC) must be
      // verbatim — width math elsewhere relies on it.
      expect(out).toContain(`${ST}main${OSC_8_OPEN}`)
    })
  })
})
