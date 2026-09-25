import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against hardcoded ANSI/hex color literals creeping back into the
 * runtime/surfaces layers (OSS-2784 / #2165). Those layers should only ever
 * consume colors resolved from `LogInkTheme` (`theme.colors.*`) so every
 * preset — and `NO_COLOR` — stays in control of what gets rendered.
 * `chrome/` is intentionally out of scope: `syntaxColors.ts` and
 * `graphLanes.ts`'s `DEFAULT_LANE_PALETTE` hold deliberate ANSI fallbacks.
 */
describe('runtime/surfaces avoid hardcoded color literals', () => {
  const roots = [join(__dirname, 'runtime'), join(__dirname, 'surfaces')]
  const antipattern = /(?:^|[^a-zA-Z])(?:color|borderColor|backgroundColor):\s*['"]/

  function collectSourceFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries.flatMap((entry) => {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__snapshots__' || entry.name === '__fixtures__') {
          return []
        }
        return collectSourceFiles(fullPath)
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
        return []
      }
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
        return []
      }
      return [fullPath]
    })
  }

  it('contains no `color: \'...\'`-style literals', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of collectSourceFiles(root)) {
        const contents = readFileSync(file, 'utf8')
        if (antipattern.test(contents)) {
          offenders.push(file)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
