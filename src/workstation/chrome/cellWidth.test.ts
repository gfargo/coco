import { execFileSync } from 'node:child_process'
import { cellWidth } from './cellWidth'

/**
 * `string-width` is ESM-only and can't be `require`d under ts-jest/CJS
 * (see the header comment in `cellWidth.ts`), so this spawns a native-ESM
 * Node subprocess to use the real installed package as a test oracle.
 * Precedent for spawning node in unit tests: `resolveGitRepoRoot.test.ts`,
 * `glabCompat.test.ts`.
 */
function realStringWidths(samples: string[]): number[] {
  const entry = require.resolve('string-width')
  const script = [
    `const {default: stringWidth} = await import(${JSON.stringify(entry)});`,
    `const samples = JSON.parse(process.argv[1]);`,
    `process.stdout.write(JSON.stringify(samples.map((s) => stringWidth(s))));`,
  ].join('\n')

  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script, JSON.stringify(samples)],
    { encoding: 'utf8' }
  )

  return JSON.parse(output)
}

describe('cellWidth matches string-width@8.2.1 (OSS-2785)', () => {
  const SAMPLES = [
    'abc',
    '',
    '変更',
    '漢字',
    '한글',
    'ｱ',
    '：',
    'é', // precomposed
    'é', // combining acute accent
    '\tfoo',
    // VS16 (emoji presentation selector) — coco under-counted these as 1.
    '❤️',
    '☀️',
    '✔️',
    '☑️',
    '➡️',
    '⬆️',
    '⚠️',
    '✏️',
    '1️⃣', // keycap
    '👍', // plain emoji
    '👍🏽', // skin-tone modifier
    '👨‍👩‍👧‍👦', // ZWJ family sequence
    '🇺🇸', // regional-indicator flag
    '🏳️‍🌈', // ZWJ flag
    '⏲',
    // Glyphs the #1706 / OSS-1774 regression tests already pin.
    '✓',
    '✗',
    '⚠',
    '✚',
    '❯',
    '⏳',
    '⌛',
    '✨',
    '✅',
    '🫡',
    '⭐',
    '⬛',
    '⭕',
  ]

  it('agrees with the real string-width package for every sample', () => {
    const expected = realStringWidths(SAMPLES)
    const actual = SAMPLES.map((s) => cellWidth(s))
    expect(actual).toEqual(expected)
  })
})
