import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against the antipattern `truncateCells(x, W).padEnd(W)` creeping
 * back in (#1860): `truncateCells` measures in display cells while
 * `padEnd` pads in UTF-16 code units, so a wide-glyph value overshoots the
 * target column by one fill char per wide character. The fix is
 * `padCells(truncateCells(x, W), W)` — see `chrome/text.ts`.
 */
describe('workstation surfaces avoid the truncateCells(...).padEnd(...) antipattern', () => {
  const surfacesDir = join(__dirname)
  const antipattern = /truncateCells\([^)]*\)\.padEnd\(/

  function collectIndexFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries.flatMap((entry) => {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        return collectIndexFiles(fullPath)
      }
      return entry.name === 'index.ts' ? [fullPath] : []
    })
  }

  it('contains no truncateCells(...).padEnd(...) call sites', () => {
    const offenders: string[] = []
    for (const file of collectIndexFiles(surfacesDir)) {
      const contents = readFileSync(file, 'utf8')
      if (antipattern.test(contents)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
