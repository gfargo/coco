import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getConflictMarkers,
  getGitOperationOverview,
  getHookOverview,
  getInProgressOperationType,
  parseConflictMarkers,
  parseConflictedFiles,
} from './operationData'

describe('log operation data', () => {
  it('detects conflicted files from porcelain status', () => {
    expect(parseConflictedFiles([
      'UU src/conflict.ts',
      'AA src/add-both.ts',
      ' M src/normal.ts',
      '?? src/new.ts',
    ].join('\n'))).toEqual([
      {
        path: 'src/conflict.ts',
        indexStatus: 'U',
        worktreeStatus: 'U',
      },
      {
        path: 'src/add-both.ts',
        indexStatus: 'A',
        worktreeStatus: 'A',
      },
    ])
  })

  it('parses conflict markers with line numbers', () => {
    expect(parseConflictMarkers('src/conflict.ts', [
      'const value = 1',
      '<<<<<<< HEAD',
      'current',
      '=======',
      'incoming',
      '>>>>>>> branch',
    ].join('\n'))).toEqual([
      {
        path: 'src/conflict.ts',
        line: 2,
        marker: '<<<<<<< HEAD',
      },
      {
        path: 'src/conflict.ts',
        line: 4,
        marker: '=======',
      },
      {
        path: 'src/conflict.ts',
        line: 6,
        marker: '>>>>>>> branch',
      },
    ])
  })

  it('loads conflict markers from conflicted files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coco-conflicts-'))
    const filePath = join(root, 'src/conflict.ts')

    mkdirSync(join(root, 'src'))
    writeFileSync(filePath, [
      '<<<<<<< HEAD',
      'current',
      '=======',
      'incoming',
      '>>>>>>> branch',
    ].join('\n'))

    const git = {
      revparse: jest.fn().mockResolvedValue(root),
    }

    try {
      await expect(getConflictMarkers(git as never, [{
        path: 'src/conflict.ts',
        indexStatus: 'U',
        worktreeStatus: 'U',
      }])).resolves.toHaveLength(3)
    } finally {
      rmSync(root, {
        force: true,
        recursive: true,
      })
    }
  })

  it('detects in-progress operations from git paths', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'coco-operation-'))
    const mergeHead = join(tempDir, 'MERGE_HEAD')

    writeFileSync(mergeHead, 'abc123')

    const git = {
      revparse: jest.fn().mockImplementation(async (args: string[]) => join(tempDir, args.at(-1) as string)),
    }

    try {
      await expect(getInProgressOperationType(git as never)).resolves.toBe('merge')
    } finally {
      rmSync(tempDir, {
        force: true,
        recursive: true,
      })
    }
  })

  it('loads hook overview from default hooks path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coco-hooks-'))
    const hooksPath = join(root, '.git/hooks')

    mkdirSync(hooksPath, {
      recursive: true,
    })
    writeFileSync(join(hooksPath, 'pre-commit'), '#!/bin/sh\n')
    writeFileSync(join(hooksPath, 'pre-push.sample'), '#!/bin/sh\n')

    const git = {
      raw: jest.fn().mockRejectedValue(new Error('missing config')),
      revparse: jest.fn().mockImplementation(async (args: string[]) => {
        if (args.includes('--show-toplevel')) {
          return root
        }

        return hooksPath
      }),
    }

    try {
      await expect(getHookOverview(git as never)).resolves.toEqual({
        hooksPath,
        configuredHooks: ['pre-commit'],
      })
    } finally {
      rmSync(root, {
        force: true,
        recursive: true,
      })
    }
  })

  it('loads the combined operation overview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coco-operation-overview-'))
    const gitDir = join(root, '.git')
    const mergeHead = join(gitDir, 'MERGE_HEAD')
    const hooksPath = join(gitDir, 'hooks')
    const conflictPath = join(root, 'conflict.ts')

    mkdirSync(hooksPath, {
      recursive: true,
    })
    writeFileSync(mergeHead, 'abc123')
    writeFileSync(join(hooksPath, 'commit-msg'), '#!/bin/sh\n')
    writeFileSync(conflictPath, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n')

    const git = {
      raw: jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'status') {
          return 'UU conflict.ts\n'
        }

        throw new Error('missing config')
      }),
      revparse: jest.fn().mockImplementation(async (args: string[]) => {
        if (args.includes('--show-toplevel')) {
          return root
        }

        return join(gitDir, args.at(-1) as string)
      }),
    }

    try {
      await expect(getGitOperationOverview(git as never)).resolves.toMatchObject({
        operation: 'merge',
        conflictedFiles: [
          {
            path: 'conflict.ts',
            indexStatus: 'U',
            worktreeStatus: 'U',
          },
        ],
        aiConflictHelpAvailable: true,
      })
    } finally {
      rmSync(root, {
        force: true,
        recursive: true,
      })
    }
  })
})

