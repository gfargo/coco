import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'

/**
 * Proves the `.eslintrc` `no-restricted-syntax` override (OSS-2221) does
 * what it's supposed to: pass on the files already migrated to the
 * `src/lib/i18n/en.ts` catalog, and catch a reintroduced inline literal.
 * Drives the real ESLint Node API rather than re-implementing the rule's
 * selector matching, so a future edit to the override is checked against
 * actual ESLint behavior.
 */
describe('i18n inline-literal lint guard (OSS-2221)', () => {
  const repoRoot = join(__dirname, '..', '..')
  const scopedFiles = [
    'src/workstation/chrome/layout.ts',
    'src/workstation/chrome/aiErrors.ts',
    'src/workstation/runtime/inkKeymap.ts',
    'src/workstation/runtime/helpOverlayState.ts',
    'src/workstation/runtime/footer.ts',
  ]

  const restrictedSyntaxMessages = (result: { messages: Array<{ ruleId: string | null }> }) =>
    result.messages.filter((message) => message.ruleId === 'no-restricted-syntax')

  it('passes on every file already migrated to the catalog', async () => {
    const eslint = new ESLint({ cwd: repoRoot })
    for (const relativePath of scopedFiles) {
      const filePath = join(repoRoot, relativePath)
      const source = readFileSync(filePath, 'utf8')
      const [result] = await eslint.lintText(source, { filePath })
      expect(restrictedSyntaxMessages(result)).toEqual([])
    }
  })

  it('flags a reintroduced inline literal binding', async () => {
    const eslint = new ESLint({ cwd: repoRoot })
    const filePath = join(repoRoot, 'src/workstation/runtime/inkKeymap.ts')
    const fixture = `
      export const reintroduced = {
        id: 'reintroducedBinding',
        keys: ['M'],
        label: 'merge',
        description: 'Merge the cursored branch into the current branch.',
        contexts: ['branches'],
      }
    `
    const [result] = await eslint.lintText(fixture, { filePath })
    expect(restrictedSyntaxMessages(result).length).toBeGreaterThan(0)
  })

  it('leaves helpOverlayState.ts vacuously passing — the file has no string literals to migrate', () => {
    // Called out explicitly rather than implied: this file's lint pass
    // doesn't demonstrate the rule catching anything, just that it
    // doesn't false-positive on code with no user-facing copy at all.
    const source = readFileSync(join(repoRoot, 'src/workstation/runtime/helpOverlayState.ts'), 'utf8')
    expect(/label\s*:\s*['"]/.test(source) || /description\s*:\s*['"]/.test(source)).toBe(false)
  })
})
