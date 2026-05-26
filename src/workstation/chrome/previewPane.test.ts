import { BranchRef } from '../../git/branchData'
import { StashEntry } from '../../git/stashData'
import { GitTagRef } from '../../git/tagData'
import {
  PreviewLine,
  formatBranchPreview,
  formatStashPreview,
  formatTagPreview,
} from './previewPane'

const text = (lines: PreviewLine[]): string[] => lines.map((line) => line.text)

const baseBranch = (overrides: Partial<BranchRef> = {}): BranchRef => ({
  type: 'local',
  name: 'refs/heads/feat/foo',
  shortName: 'feat/foo',
  hash: '1234567890abcdef',
  upstream: undefined,
  current: false,
  remote: undefined,
  date: '2026-04-30',
  subject: 'add the foo widget',
  ahead: 0,
  behind: 0,
  ...overrides,
})

const baseTag = (overrides: Partial<GitTagRef> = {}): GitTagRef => ({
  name: 'v1.2.3',
  hash: 'deadbeefcafebabe',
  date: '2026-04-15',
  subject: 'release v1.2.3',
  ...overrides,
})

const baseStash = (overrides: Partial<StashEntry> = {}): StashEntry => ({
  ref: 'stash@{0}',
  hash: 'cafef00dba5eba11',
  baseHash: 'base0fb45e0fb45e0',
  date: '2026-04-29',
  branch: 'feat/foo',
  message: 'WIP debugging',
  files: ['src/lib/foo.ts', 'src/lib/foo.test.ts'],
  ...overrides,
})

describe('log Ink preview pane (P4.1)', () => {
  describe('formatBranchPreview', () => {
    it('returns a hint when nothing is selected', () => {
      const lines = formatBranchPreview(undefined)
      expect(lines).toHaveLength(1)
      expect(lines[0].text).toMatch(/Select a branch/i)
      expect(lines[0].emphasis).toBe('dim')
    })

    it('shows tip metadata + an in-sync line for an even branch', () => {
      const lines = formatBranchPreview(baseBranch({ upstream: 'origin/feat/foo' }))
      const out = text(lines)
      expect(out[0]).toBe('feat/foo')
      expect(lines[0].emphasis).toBe('heading')
      expect(out).toEqual(expect.arrayContaining([
        expect.stringMatching(/Tip:.*1234567/),
        'Date:   2026-04-30',
        'Subject: add the foo widget',
        'Upstream: origin/feat/foo',
        'Status:   in sync',
      ]))
    })

    it('describes ahead/behind divergence in plain prose', () => {
      const lines = formatBranchPreview(baseBranch({ upstream: 'origin/main', ahead: 3, behind: 1 }))
      expect(text(lines)).toEqual(expect.arrayContaining([
        'Status:   3 ahead, 1 behind',
      ]))
    })

    it('flags a missing upstream', () => {
      const lines = formatBranchPreview(baseBranch())
      expect(lines.some((line) => line.text === 'No upstream tracking.' && line.emphasis === 'dim')).toBe(true)
    })

    it('marks the current branch with a footer note', () => {
      const lines = formatBranchPreview(baseBranch({ current: true, upstream: 'origin/main' }))
      const lastLines = lines.slice(-2)
      expect(lastLines[1].text).toMatch(/current branch/)
      expect(lastLines[1].emphasis).toBe('dim')
    })

    it('falls back to placeholders for missing date/subject', () => {
      const lines = formatBranchPreview(baseBranch({ date: '', subject: '' }))
      const out = text(lines)
      expect(out).toEqual(expect.arrayContaining([
        'Date:   <unknown>',
        'Subject: <no subject>',
      ]))
    })
  })

  describe('formatTagPreview', () => {
    it('returns a hint when nothing is selected', () => {
      const lines = formatTagPreview(undefined)
      expect(lines[0].text).toMatch(/Select a tag/i)
      expect(lines[0].emphasis).toBe('dim')
    })

    it('returns name as heading and the commit metadata + subject body', () => {
      const lines = formatTagPreview(baseTag())
      expect(lines[0].text).toBe('v1.2.3')
      expect(lines[0].emphasis).toBe('heading')
      const out = text(lines)
      expect(out).toEqual(expect.arrayContaining([
        expect.stringMatching(/Commit:.*deadbee/),
        'Date:    2026-04-15',
        'Subject:',
        '  release v1.2.3',
      ]))
    })

    it('handles tags with missing date/subject', () => {
      const lines = formatTagPreview(baseTag({ date: '', subject: '' }))
      const out = text(lines)
      expect(out).toEqual(expect.arrayContaining(['Date:    <unknown>', '  <no subject>']))
    })
  })

  describe('formatStashPreview', () => {
    it('returns a hint when nothing is selected', () => {
      const lines = formatStashPreview(undefined)
      expect(lines[0].text).toMatch(/Select a stash/i)
      expect(lines[0].emphasis).toBe('dim')
    })

    it('returns ref + branch + message + file list', () => {
      const lines = formatStashPreview(baseStash())
      expect(lines[0].text).toBe('stash@{0}')
      expect(lines[0].emphasis).toBe('heading')
      const out = text(lines)
      expect(out).toEqual(expect.arrayContaining([
        'On:      feat/foo',
        expect.stringMatching(/Commit:.*cafef00/),
        'Date:    2026-04-29',
        'Message:',
        '  WIP debugging',
        'Files (2):',
        '  src/lib/foo.ts',
        '  src/lib/foo.test.ts',
      ]))
    })

    it('caps long file lists and reports the overflow', () => {
      const files = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`)
      const lines = formatStashPreview(baseStash({ files }), { fileCap: 10 })
      const out = text(lines)
      expect(out).toContain('Files (15):')
      expect(out).toContain('  src/file9.ts')
      expect(out).not.toContain('  src/file10.ts')
      expect(out.some((line) => /…\s5 more/.test(line))).toBe(true)
    })

    it('flags an empty file list as dim', () => {
      const lines = formatStashPreview(baseStash({ files: [] }))
      expect(lines.some((line) => line.text === 'No files in stash.' && line.emphasis === 'dim')).toBe(true)
    })
  })
})
