import { buildPrompt } from './buildPrompt'
import { ReviewFeedbackItem } from '../../commands/review/config'

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}))

import * as fs from 'fs'

const mockReadFile = fs.promises.readFile as jest.Mock

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

describe('buildPrompt', () => {
  it('includes all ReviewFeedbackItem fields in the prompt', async () => {
    mockReadFile.mockResolvedValue('const x = 1')

    const prompt = await buildPrompt(item)

    expect(prompt).toContain(item.title)
    expect(prompt).toContain(item.summary)
    expect(prompt).toContain(`${item.severity}/10`)
    expect(prompt).toContain(item.category)
    expect(prompt).toContain(item.filePath)
  })

  it('includes file contents when file exists', async () => {
    const fileContents = 'export function parse(input: string) { return JSON.parse(input) }'
    mockReadFile.mockResolvedValue(fileContents)

    const prompt = await buildPrompt(item)

    expect(prompt).toContain(fileContents)
    expect(mockReadFile).toHaveBeenCalledWith(item.filePath, 'utf-8')
  })

  it('uses the file extension in the code fence', async () => {
    mockReadFile.mockResolvedValue('const x = 1')

    const prompt = await buildPrompt(item)

    expect(prompt).toContain('```ts')
  })

  it('includes warning note when file is not found', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const prompt = await buildPrompt(item)

    expect(prompt).toContain(`[WARNING: File "${item.filePath}" was not found on disk`)
    expect(prompt).not.toContain('```')
  })

  it('still includes all metadata fields when file is not found', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const prompt = await buildPrompt(item)

    expect(prompt).toContain(item.title)
    expect(prompt).toContain(item.summary)
    expect(prompt).toContain(`${item.severity}/10`)
    expect(prompt).toContain(item.category)
    expect(prompt).toContain(item.filePath)
  })
})
