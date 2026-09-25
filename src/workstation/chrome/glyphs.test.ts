import { cellWidth } from './text'
import { pickWorkstationGlyph, WORKSTATION_GLYPHS, WORKSTATION_ASCII_GLYPHS } from './glyphs'

describe('workstation glyph table', () => {
  const keys = Object.keys(WORKSTATION_GLYPHS) as (keyof typeof WORKSTATION_GLYPHS)[]

  it.each(keys)('"%s" has a printable-ASCII fallback', (key) => {
    expect(WORKSTATION_ASCII_GLYPHS[key]).toMatch(/^[\x20-\x7e]+$/)
  })

  it.each(keys.filter((key) => key !== 'ellipsis'))(
    '"%s" keeps the same cell width in both dialects',
    (key) => {
      expect(cellWidth(WORKSTATION_ASCII_GLYPHS[key])).toBe(cellWidth(WORKSTATION_GLYPHS[key]))
    }
  )

  it('ellipsis is the deliberate width exception (1 unicode cell vs 3 ascii cells)', () => {
    expect(cellWidth(WORKSTATION_GLYPHS.ellipsis)).toBe(1)
    expect(cellWidth(WORKSTATION_ASCII_GLYPHS.ellipsis)).toBe(3)
  })

  it('pickWorkstationGlyph selects the right dialect', () => {
    expect(pickWorkstationGlyph('check')).toBe('✓')
    expect(pickWorkstationGlyph('check', false)).toBe('✓')
    expect(pickWorkstationGlyph('check', true)).toBe('+')
  })

  it('hollow and target have distinct ASCII fallbacks (workspace sidebar tabs)', () => {
    // Both ○ (hollow/all-repos) and ⊙ (target/PRs) must render differently in
    // ASCII mode so the two workspace sidebar tabs stay visually distinguishable.
    expect(WORKSTATION_ASCII_GLYPHS.hollow).not.toBe(WORKSTATION_ASCII_GLYPHS.target)
  })

  it('new glyphs (left, downtri, gutter, halfleft, endash) round-trip correctly', () => {
    expect(pickWorkstationGlyph('left', false)).toBe('←')
    expect(pickWorkstationGlyph('left', true)).toBe('<')
    expect(pickWorkstationGlyph('downtri', false)).toBe('▼')
    expect(pickWorkstationGlyph('downtri', true)).toBe('v')
    expect(pickWorkstationGlyph('gutter', false)).toBe('▎')
    expect(pickWorkstationGlyph('gutter', true)).toBe('|')
    expect(pickWorkstationGlyph('halfleft', false)).toBe('▌')
    expect(pickWorkstationGlyph('halfleft', true)).toBe('|')
    expect(pickWorkstationGlyph('endash', false)).toBe('–')
    expect(pickWorkstationGlyph('endash', true)).toBe('-')
  })
})
