import { buildPrompt } from './buildPrompt'
import { ReviewFeedbackItem } from '../../commands/review/config'

// We mock 'fs' for the simple found/not-found tests so we can assert readFile
// calls without real I/O. Symlink-escape tests live in
// buildPrompt.realfs.test.ts (no fs mock there).

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}))

import * as mockFs from 'fs'
const mockReadFile = mockFs.promises.readFile as jest.Mock

const FAKE_REPO_ROOT = '/fake/repo'

const item: ReviewFeedbackItem = {
  title: 'Missing null check',
  summary: 'The function does not handle null input and will throw a TypeError.',
  severity: 7,
  category: 'Bug',
  filePath: 'src/utils/parse.ts',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildPrompt — found/not-found (mocked fs)', () => {
  it('includes all ReviewFeedbackItem fields in the prompt', async () => {
    mockReadFile.mockResolvedValue('const x = 1')

    const prompt = await buildPrompt(item, FAKE_REPO_ROOT)

    expect(prompt).toContain(item.title)
    expect(prompt).toContain(item.summary)
    expect(prompt).toContain(`${item.severity}/10`)
    expect(prompt).toContain(item.category)
    expect(prompt).toContain(item.filePath)
  })

  it('includes file contents when file exists', async () => {
    const fileContents = 'export function parse(input: string) { return JSON.parse(input) }'
    mockReadFile.mockResolvedValue(fileContents)

    const prompt = await buildPrompt(item, FAKE_REPO_ROOT)

    expect(prompt).toContain(fileContents)
  })

  it('uses the file extension in the code fence', async () => {
    mockReadFile.mockResolvedValue('const x = 1')

    const prompt = await buildPrompt(item, FAKE_REPO_ROOT)

    expect(prompt).toContain('```ts')
  })

  it('includes warning note when file is not found', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const prompt = await buildPrompt(item, FAKE_REPO_ROOT)

    expect(prompt).toContain(`[WARNING: File "${item.filePath}" was not found on disk`)
    expect(prompt).not.toContain('```')
  })

  it('still includes all metadata fields when file is not found', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const prompt = await buildPrompt(item, FAKE_REPO_ROOT)

    expect(prompt).toContain(item.title)
    expect(prompt).toContain(item.summary)
    expect(prompt).toContain(`${item.severity}/10`)
    expect(prompt).toContain(item.category)
    expect(prompt).toContain(item.filePath)
  })
})

describe('buildPrompt — path confinement rejection (mocked fs)', () => {
  it('rejects a .. traversal path without calling readFile', async () => {
    const traversalItem: ReviewFeedbackItem = { ...item, filePath: '../secret.txt' }

    const prompt = await buildPrompt(traversalItem, FAKE_REPO_ROOT)

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(prompt).toContain('[REJECTED:')
    expect(prompt).toContain('../secret.txt')
    expect(prompt).toContain('traversal')
  })

  it('rejects an absolute path without calling readFile', async () => {
    const absoluteItem: ReviewFeedbackItem = { ...item, filePath: '/etc/passwd' }

    const prompt = await buildPrompt(absoluteItem, FAKE_REPO_ROOT)

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(prompt).toContain('[REJECTED:')
    expect(prompt).toContain('/etc/passwd')
    expect(prompt).toContain('absolute')
  })

  it('rejects a deep .. traversal without calling readFile', async () => {
    const traversalItem: ReviewFeedbackItem = { ...item, filePath: 'a/../../etc/shadow' }

    const prompt = await buildPrompt(traversalItem, FAKE_REPO_ROOT)

    expect(mockReadFile).not.toHaveBeenCalled()
    expect(prompt).toContain('[REJECTED:')
    expect(prompt).toContain('traversal')
  })

  it('still includes all metadata fields for a rejected path', async () => {
    const rejectedItem: ReviewFeedbackItem = { ...item, filePath: '../escape.txt' }

    const prompt = await buildPrompt(rejectedItem, FAKE_REPO_ROOT)

    expect(prompt).toContain(rejectedItem.title)
    expect(prompt).toContain(rejectedItem.summary)
    expect(prompt).toContain(`${rejectedItem.severity}/10`)
    expect(prompt).toContain(rejectedItem.category)
  })
})
