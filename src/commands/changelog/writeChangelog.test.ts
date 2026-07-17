import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildChangelogSection, splitChangelogMessage, writeChangelogFile } from './writeChangelog'

describe('buildChangelogSection', () => {
  it('renders a `## title — date` heading followed by the trimmed content', () => {
    const section = buildChangelogSection('v1.2.0', '\n- did a thing\n- did another\n\n', '2026-07-13')
    expect(section).toBe('## v1.2.0 — 2026-07-13\n\n- did a thing\n- did another\n')
  })
})

describe('splitChangelogMessage', () => {
  it('splits multi-line content into a title and the remaining body', () => {
    expect(splitChangelogMessage('v1.2.0\n\n- did a thing\n- did another')).toEqual({
      title: 'v1.2.0',
      content: '- did a thing\n- did another',
    })
  })

  it('normalizes CRLF input', () => {
    expect(splitChangelogMessage('v1.2.0\r\n\r\n- did a thing\r\n- did another')).toEqual({
      title: 'v1.2.0',
      content: '- did a thing\n- did another',
    })
  })

  it('returns empty content for a single-line message with no newline', () => {
    expect(splitChangelogMessage('v1.2.0')).toEqual({ title: 'v1.2.0', content: '' })
  })

  it('keeps a trailing ticket footer inside the content', () => {
    const message = 'v1.2.0\n\n- did a thing\n\nPart of **OSS-993**'
    expect(splitChangelogMessage(message)).toEqual({
      title: 'v1.2.0',
      content: '- did a thing\n\nPart of **OSS-993**',
    })
  })

  it('roundtrips a `${title}\\n\\n${content}` message back to its original parts', () => {
    const title = 'v1.2.0'
    const content = '- did a thing\n- did another\n\nPart of **OSS-993**'
    expect(splitChangelogMessage(`${title}\n\n${content}`)).toEqual({ title, content })
  })
})

describe('writeChangelogFile', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-changelog-write-'))
    filePath = path.join(dir, 'CHANGELOG.md')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates the file with a standard header when it does not exist', () => {
    writeChangelogFile({ filePath, title: 'v1.0.0', content: '- initial release', date: '2026-07-13' })
    const written = fs.readFileSync(filePath, 'utf8')
    expect(written).toContain('# Changelog')
    expect(written).toContain('## v1.0.0 — 2026-07-13')
    expect(written).toContain('- initial release')
  })

  it('inserts a new section right after the top-level heading, above existing sections', () => {
    fs.writeFileSync(filePath, '# Changelog\n\n## v1.0.0 — 2026-07-01\n\n- initial release\n')
    writeChangelogFile({ filePath, title: 'v1.1.0', content: '- a new feature', date: '2026-07-13' })
    const written = fs.readFileSync(filePath, 'utf8')
    const v11Index = written.indexOf('## v1.1.0')
    const v10Index = written.indexOf('## v1.0.0')
    expect(v11Index).toBeGreaterThan(-1)
    expect(v10Index).toBeGreaterThan(-1)
    expect(v11Index).toBeLessThan(v10Index)
    expect(written).toContain('- initial release')
    expect(written).toContain('- a new feature')
  })

  it('replaces an existing section with the same title in place instead of duplicating it', () => {
    fs.writeFileSync(
      filePath,
      [
        '# Changelog',
        '',
        '## v1.1.0 — 2026-07-13',
        '',
        '- first draft of the feature',
        '',
        '## v1.0.0 — 2026-07-01',
        '',
        '- initial release',
        '',
      ].join('\n')
    )
    writeChangelogFile({ filePath, title: 'v1.1.0', content: '- final wording of the feature', date: '2026-07-13' })
    const written = fs.readFileSync(filePath, 'utf8')

    expect(written).not.toContain('first draft')
    expect(written).toContain('final wording of the feature')
    // Still exactly one v1.1.0 heading — not duplicated.
    expect(written.split('## v1.1.0').length - 1).toBe(1)
    // The older section is untouched.
    expect(written).toContain('## v1.0.0 — 2026-07-01')
    expect(written).toContain('- initial release')
  })

  it('does not match a title that is a prefix of another title', () => {
    fs.writeFileSync(filePath, '# Changelog\n\n## v1.0 — 2026-07-01\n\n- old\n')
    writeChangelogFile({ filePath, title: 'v1.0.0', content: '- new', date: '2026-07-13' })
    const written = fs.readFileSync(filePath, 'utf8')
    // Both headings survive — v1.0.0 was inserted as new, not merged into v1.0's section.
    expect(written).toContain('## v1.0 — 2026-07-01')
    expect(written).toContain('## v1.0.0 — 2026-07-13')
    expect(written).toContain('- old')
    expect(written).toContain('- new')
  })

  it('does not match a title that is a word-prefix of another title', () => {
    fs.writeFileSync(filePath, '# Changelog\n\n## v1.0 hotfix — 2026-06-01\n\n- hotfix notes\n')
    writeChangelogFile({ filePath, title: 'v1.0', content: '- new', date: '2026-07-13' })
    const written = fs.readFileSync(filePath, 'utf8')
    // Both headings survive — v1.0 was inserted as new, not merged into v1.0 hotfix's section.
    expect(written).toContain('## v1.0 hotfix — 2026-06-01')
    expect(written).toContain('## v1.0 — 2026-07-13')
    expect(written).toContain('- hotfix notes')
    expect(written).toContain('- new')
  })
})
