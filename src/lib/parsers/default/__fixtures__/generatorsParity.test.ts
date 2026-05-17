/**
 * Parity check between the two vendored copies of `generators.ts` —
 * the coco-side one (`src/lib/parsers/default/__fixtures__/`) and
 * the `@gfargo/git-scenarios` package copy
 * (`packages/git-scenarios/src/__fixtures__/`).
 *
 * The package is shadow-extracted today (`private: true`); both
 * copies need to stay byte-identical until the package publishes,
 * at which point either the parser fixtures switch to importing
 * from the package or the generators get extracted to a third
 * peer package.
 *
 * Direct file diff would be brittle (the cross-reference docstrings
 * intentionally differ). This test compares **generator output**
 * across a representative set of (path, tokens, seed) inputs — if
 * either copy drifts in implementation, the seeded output diverges
 * and this fails loudly.
 */

import { generateContentForFile as cocoGenerate } from './generators'
import { generateContentForFile as packageGenerate } from '../../../../../packages/git-scenarios/src/__fixtures__/generators'

describe('generators parity (coco ↔ @gfargo/git-scenarios)', () => {
  // Representative inputs: each language path the generators dispatch on,
  // with a couple of seed / token combos to catch off-by-one drift inside
  // any single generator.
  const cases: Array<{ path: string; tokens: number; seed: number }> = [
    { path: 'src/widget.ts', tokens: 80, seed: 0xc0c0a11e },
    { path: 'src/widget.tsx', tokens: 80, seed: 0xc0c0a11e },
    { path: 'src/widget.js', tokens: 100, seed: 0x1234 },
    { path: 'README.md', tokens: 120, seed: 0xfeed },
    { path: 'src/widget.py', tokens: 60, seed: 0xabc },
    { path: 'config.yaml', tokens: 50, seed: 0xdef },
    { path: 'data.json', tokens: 40, seed: 0xff },
    { path: 'unknown.xyz', tokens: 70, seed: 0xa11 },
  ]

  for (const { path, tokens, seed } of cases) {
    it(`produces identical output for (${path}, tokens=${tokens}, seed=0x${seed.toString(16)})`, () => {
      const cocoOutput = cocoGenerate(path, tokens, seed)
      const packageOutput = packageGenerate(path, tokens, seed)
      expect(packageOutput).toBe(cocoOutput)
    })
  }
})
