import { FileChange } from '../../../types'

export class DiffTreeNode {
  path: string[] = []
  files: FileChange[] = []
  children: Map<string, DiffTreeNode> = new Map()

  constructor(path?: string[]) {
    if (path) this.path = path
  }

  addFile(file: FileChange): void {
    this.files.push(file)
  }

  addChild(part: string, node: DiffTreeNode): void {
    this.children.set(part, node)
  }

  getChild(part: string): DiffTreeNode | undefined {
    return this.children.get(part)
  }

  getPath(): string {
    return this.path.join('/')
  }

  print(indentation = 0): string {
    const indent = ' '.repeat(indentation);
    let output = `${indent}- Path: ${this.getPath()}\n`;

    if (this.files.length > 0) {
      output += `${indent}  Files:\n`;
      for (const file of this.files) {
        output += `${indent}    - ${file.summary}\n`;
      }
    }

    if (this.children.size > 0) {
      output += `${indent}  Children:\n`;
      for (const [, child] of this.children) {
        output += child.print(indentation + 4);
      }
    }

    return output;
  }
}

export const createDiffTree = (changes: FileChange[]): DiffTreeNode => {
  const root = new DiffTreeNode()

  for (const change of changes) {
    let currentParent = root
    const parts = change.filePath.split('/')
    parts.pop()

    for (const part of parts) {
      let childNode = currentParent.getChild(part)

      if (!childNode) {
        childNode = new DiffTreeNode([...currentParent.path, part])
        currentParent.addChild(part, childNode)
      }

      currentParent = childNode
    }

    // Create a NodeFile object and add it to the parent
    currentParent.addFile({
      filePath: change.filePath,
      oldFilePath: change.oldFilePath,
      summary: change.summary,
      status: change.status,
    })
  }

  return root
}
