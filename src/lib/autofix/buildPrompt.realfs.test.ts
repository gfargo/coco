/**
 * buildPrompt tests that require a real filesystem (no fs mock).
 * Covers symlink escapes and legitimate in-root reads.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildPrompt } from './buildPrompt'
import { ReviewFeedbackItem } from '../../commands/review/config'

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-buildprompt-'))
  return fs.realpathSync(dir)
}

const baseItem: ReviewFeedbackItem = {
  title: 'Missing null check',
  summary: 'The function does not handle null input.',
  severity: 7,
  category: 'Bug',
  filePath: 'src/utils/parse.ts',
}

describe('buildPrompt — real filesystem', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = makeTempDir()
    outside = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('reads and inlines a legitimate in-root file', async () => {
    fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'utils', 'parse.ts'), 'export const x = 1')

    const prompt = await buildPrompt(baseItem, root)

    expect(prompt).toContain('export const x = 1')
    expect(prompt).toContain('```ts')
    expect(prompt).not.toContain('[REJECTED:')
    expect(prompt).not.toContain('[WARNING:')
  })

  it('produces a not-found warning for a missing in-root file', async () => {
    // file does not exist on disk — confineRepoPath allows it, readFile throws
    const prompt = await buildPrompt(baseItem, root)

    expect(prompt).toContain('[WARNING: File "src/utils/parse.ts" was not found on disk')
    expect(prompt).not.toContain('[REJECTED:')
  })

  it('rejects a symlink inside root pointing outside (contents never read)', async () => {
    const secret = path.join(outside, 'secret.txt')
    fs.writeFileSync(secret, 'TOP-SECRET-OUTSIDE')
    const link = path.join(root, 'escape.txt')
    fs.symlinkSync(secret, link)

    const escapingItem: ReviewFeedbackItem = { ...baseItem, filePath: 'escape.txt' }
    const prompt = await buildPrompt(escapingItem, root)

    expect(prompt).toContain('[REJECTED:')
    expect(prompt).not.toContain('TOP-SECRET-OUTSIDE')
  })
})
