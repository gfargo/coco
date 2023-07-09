import { FileChange } from '../../../types'
import { DiffTreeNode, createDiffTree } from './createDiffTree' // Assuming the path to the module

describe('DiffTreeNode', () => {
  it('should initialize correctly', () => {
    const node = new DiffTreeNode(['root', 'path'])

    expect(node.path).toEqual(['root', 'path'])
    expect(node.files).toEqual([])
    expect(node.children).toEqual(new Map())
  })

  it('should add a file correctly', () => {
    const node = new DiffTreeNode()
    const file: FileChange = {
      summary: 'added: test.txt',
      filepath: 'test.txt',
      status: 'added',
    }

    node.addFile(file)

    expect(node.files).toEqual([file])
  })

  it('should add and get a child correctly', () => {
    const node = new DiffTreeNode()
    const child = new DiffTreeNode(['child'])

    node.addChild('child', child)

    expect(node.getChild('child')).toBe(child)
  })
})

describe('createDiffTree', () => {
  const changes: FileChange[] = [
    {
      summary: 'added: src/test1.txt',
      filepath: 'src/test1.txt',
      status: 'added',
    },
    {
      summary: 'modified: src/test2.txt',
      filepath: 'src/test2.txt',
      status: 'modified',
    },
    {
      summary: 'deleted: src/utils/test3.txt',
      filepath: 'src/utils/test3.txt',
      status: 'deleted',
    },
  ]

  it('should create a tree correctly', () => {
    const root = createDiffTree(changes)

    expect(root.path).toEqual([])
    expect(root.files).toEqual([])

    const src = root.getChild('src')
    expect(src).not.toBeUndefined()
    expect(src!.files).toHaveLength(2)

    const utils = src!.getChild('utils')
    expect(utils).not.toBeUndefined()
    expect(utils!.files).toHaveLength(1)
  })
})
