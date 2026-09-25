import fs from 'fs'
import path from 'path'
import { LOG_INK_KEY_BINDINGS } from './runtime/inkKeymap'

/**
 * Regression guard for OSS-2781 / coco#2168: `KEYMAP.md`'s `g`-chord table
 * drifted from `LOG_INK_KEY_BINDINGS` (a chord existed in the registry —
 * and therefore in the `?` help, `:` palette, and `g` which-key overlay —
 * with no row documenting it). This doesn't catch every class of drift
 * (the doc's per-view tables carry prose the registry has no field for,
 * so they can't be generated/diffed automatically — see the KEYMAP.md
 * "Design doctrine" section), but it cheaply keeps the one class of drift
 * the issue actually found from recurring: every two-character `g<X>`
 * chord in the registry must appear in the doc as `` `g X` `` or `` `gX` ``.
 */
describe('KEYMAP.md g-chord table stays in sync with LOG_INK_KEY_BINDINGS', () => {
  const doc = fs.readFileSync(path.join(__dirname, 'KEYMAP.md'), 'utf8')

  const chordKeys = Array.from(
    new Set(
      LOG_INK_KEY_BINDINGS
        .flatMap((binding) => binding.keys)
        .filter((key) => /^g.$/.test(key))
    )
  )

  it('found at least one g-chord to check (sanity check for the guard itself)', () => {
    expect(chordKeys.length).toBeGreaterThan(0)
  })

  it.each(chordKeys)('documents the `%s` chord', (chord) => {
    const second = chord.charAt(1)
    const spaced = `g ${second}`
    const tight = `g${second}`
    const isDocumented = doc.includes(`\`${spaced}\``) || doc.includes(`\`${tight}\``)
    expect(isDocumented).toBe(true)
  })
})
