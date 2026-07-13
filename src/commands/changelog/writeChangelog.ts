import fs from 'fs'
import { writeFileAtomic } from '../../lib/utils/atomicFileWrite'

const DEFAULT_CHANGELOG_HEADER = '# Changelog\n'

export type ChangelogSectionInput = {
  filePath: string
  title: string
  content: string
  /** Injectable for tests; defaults to today (YYYY-MM-DD, local time). */
  date?: string
}

function todayIsoDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function buildChangelogSection(title: string, content: string, date: string): string {
  return `## ${title} — ${date}\n\n${content.trim()}\n`
}

/**
 * Idempotently insert or replace a `## {title}` section in a CHANGELOG-style
 * file (#1600). Plain markdown headings, not marker comments — a
 * human-read CHANGELOG shouldn't carry `<!-- coco:start -->`-style noise.
 *
 * - Missing file: created with a standard `# Changelog` header.
 * - No existing `## {title}` section: the new section is inserted right
 *   after the file's top-level `# ` heading (or at the very top if there
 *   isn't one), so the newest entry reads first.
 * - An existing `## {title}` section (matched on the title text, ignoring
 *   the trailing date): replaced in place — re-running for the same
 *   title updates it rather than duplicating it.
 */
export function writeChangelogFile({ filePath, title, content, date = todayIsoDate() }: ChangelogSectionInput): void {
  const section = buildChangelogSection(title, content, date)
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : DEFAULT_CHANGELOG_HEADER
  const lines = existing.split(/\r?\n/)
  const headingPrefix = `## ${title}`

  const startIndex = lines.findIndex((line) => line.trim() === headingPrefix.trim() || line.trim().startsWith(`${headingPrefix} `))

  if (startIndex !== -1) {
    let endIndex = startIndex + 1
    while (endIndex < lines.length && !lines[endIndex].startsWith('## ')) {
      endIndex += 1
    }
    // Trim the trailing blank lines the old section left behind so the
    // replacement doesn't accumulate extra blank runs on repeated writes.
    let trimmedEnd = endIndex
    while (trimmedEnd > startIndex + 1 && lines[trimmedEnd - 1].trim() === '') {
      trimmedEnd -= 1
    }
    const before = lines.slice(0, startIndex)
    const after = lines.slice(endIndex)
    const next = [...before, ...section.split(/\r?\n/), ...after]
    writeFileAtomic(filePath, next.join('\n'))
    return
  }

  const topHeadingIndex = lines.findIndex((line) => line.startsWith('# ') && !line.startsWith('## '))
  if (topHeadingIndex === -1) {
    writeFileAtomic(filePath, `${DEFAULT_CHANGELOG_HEADER}\n${section}\n${existing.trim()}\n`.trimEnd() + '\n')
    return
  }

  let insertAt = topHeadingIndex + 1
  while (insertAt < lines.length && lines[insertAt].trim() === '') {
    insertAt += 1
  }
  const before = lines.slice(0, insertAt)
  const after = lines.slice(insertAt)
  const next = [...before, '', ...section.split(/\r?\n/), ...after]
  writeFileAtomic(filePath, next.join('\n'))
}
