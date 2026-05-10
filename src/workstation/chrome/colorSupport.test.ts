import { getColorLevel, presetUsesTrueColor } from './colorSupport'

describe('log Ink color support (P5.2)', () => {
  describe('getColorLevel', () => {
    it('returns mono when NO_COLOR is set', () => {
      expect(getColorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('mono')
    })

    it('returns mono for TERM=dumb', () => {
      expect(getColorLevel({ TERM: 'dumb' })).toBe('mono')
    })

    it('honors FORCE_COLOR overrides for every level', () => {
      expect(getColorLevel({ FORCE_COLOR: '0' })).toBe('mono')
      expect(getColorLevel({ FORCE_COLOR: '1' })).toBe('16')
      expect(getColorLevel({ FORCE_COLOR: '2' })).toBe('256')
      expect(getColorLevel({ FORCE_COLOR: '3' })).toBe('truecolor')
    })

    it('returns truecolor when COLORTERM advertises it', () => {
      expect(getColorLevel({ COLORTERM: 'truecolor' })).toBe('truecolor')
      expect(getColorLevel({ COLORTERM: '24bit' })).toBe('truecolor')
      expect(getColorLevel({ COLORTERM: 'TRUECOLOR' })).toBe('truecolor')
    })

    it('returns truecolor for known terminal emulators', () => {
      expect(getColorLevel({ TERM_PROGRAM: 'iTerm.app' })).toBe('truecolor')
      expect(getColorLevel({ TERM_PROGRAM: 'WezTerm' })).toBe('truecolor')
      expect(getColorLevel({ TERM_PROGRAM: 'vscode' })).toBe('truecolor')
      expect(getColorLevel({ TERM_PROGRAM: 'ghostty' })).toBe('truecolor')
      expect(getColorLevel({ KITTY_WINDOW_ID: '1' })).toBe('truecolor')
      expect(getColorLevel({ TERM: 'xterm-kitty' })).toBe('truecolor')
      expect(getColorLevel({ WT_SESSION: 'abcd' })).toBe('truecolor')
    })

    it('returns 256 for xterm-256color and similar', () => {
      expect(getColorLevel({ TERM: 'xterm-256color' })).toBe('256')
      expect(getColorLevel({ TERM: 'screen-256color' })).toBe('256')
    })

    it('falls back to 16 for unknown terminals', () => {
      expect(getColorLevel({ TERM: 'xterm' })).toBe('16')
      expect(getColorLevel({})).toBe('16')
    })
  })

  describe('presetUsesTrueColor', () => {
    it('flags hex-color presets', () => {
      expect(presetUsesTrueColor('catppuccin')).toBe(true)
      expect(presetUsesTrueColor('gruvbox')).toBe(true)
    })

    it('returns false for ANSI-named or undefined presets', () => {
      expect(presetUsesTrueColor('default')).toBe(false)
      expect(presetUsesTrueColor('monochrome')).toBe(false)
      expect(presetUsesTrueColor(undefined)).toBe(false)
    })
  })
})
