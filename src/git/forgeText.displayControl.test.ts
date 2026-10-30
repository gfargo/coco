import { stripDisplayControl, stripDisplayControlMultiline } from './forgeText'
import { parseBlamePorcelain } from './blameData'
import { parseCommitDetail } from './logData'

const ESC = '\u001b'
const OSC52 = `${ESC}]52;c;ZXZpbA==\u0007`

describe('display-control stripping for local git text (#2204)', () => {
  it('removes escape and OSC sequences but keeps tabs', () => {
    expect(stripDisplayControl(`a${OSC52}b\tc${ESC}[31mred`)).toBe('a]52;c;ZXZpbA==b\tc[31mred')
    expect(stripDisplayControl(`x${ESC}`)).toBe('x')
  })

  it('drops carriage returns so CRLF content cannot garble a row', () => {
    expect(stripDisplayControl('line\r')).toBe('line')
    expect(stripDisplayControlMultiline('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('multi-line variant keeps newlines and tabs', () => {
    expect(stripDisplayControlMultiline(`p1\n\tp2${ESC}`)).toBe('p1\n\tp2')
  })

  it('sanitizes commit subject, author and body in parseCommitDetail', () => {
    const sep = '\u001f'
    const metadata = ['h', 's', '', 'd', `Ev${ESC}il`, '', `subj${OSC52}`, `body${ESC}[2J`].join(sep)
    const detail = parseCommitDetail(metadata, '')
    expect(detail.author).toBe('Evil')
    expect(detail.message).not.toContain(ESC)
    expect(detail.body).not.toContain(ESC)
  })

  it('sanitizes blame content and author', () => {
    const hash = 'a'.repeat(40)
    const out = [`${hash} 1 1 1`, `author Ev${ESC}il`, 'author-time 1', `\tcontent${OSC52}\r`].join('\n')
    const [line] = parseBlamePorcelain(out)
    expect(line.author).toBe('Evil')
    expect(line.content).not.toContain(ESC)
    expect(line.content).not.toContain('\r')
  })
})
