import { collectDiffs } from './collectDiffs'
import { createDiffTree } from './createDiffTree'
import { FileChange } from '../../../types'

describe('collectDiffs', () => {
  const logger = {
    verbose: jest.fn().mockReturnThis(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('limits concurrent file diff collection', async () => {
    const changes: FileChange[] = Array.from({ length: 5 }, (_, index) => ({
      filePath: `src/file${index}.ts`,
      status: 'modified',
      summary: `modified src/file${index}.ts`,
    }))

    const tree = createDiffTree(changes)
    let active = 0
    let maxActive = 0

    const getFileDiff = jest.fn(async (change: FileChange) => {
      active++
      maxActive = Math.max(maxActive, active)

      await new Promise((resolve) => setTimeout(resolve, 5))

      active--
      return `diff for ${change.filePath}`
    })

    await collectDiffs(tree, getFileDiff, (text) => text.length, logger as never, 2)

    expect(getFileDiff).toHaveBeenCalledTimes(5)
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
