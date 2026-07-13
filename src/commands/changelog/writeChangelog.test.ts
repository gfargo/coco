import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildChangelogSection, writeChangelogFile } from './writeChangelog'

describe('buildChangelogSection', () => {
  it('renders a `## title — date` heading followed by the trimmed content', () => {
    const section = buildChangelogSection('v1.2.0', '\n- did a thing\n- did another\n\n', '2026-07-13')
    expect(section).toBe('## v1.2.0 — 2026-07-13\n\n- did a thing\n- did another\n')
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
})
