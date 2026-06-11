import {
  sanitizeIssueDetail,
  sanitizeIssueListItem,
  sanitizePullRequestDetail,
  sanitizePullRequestListItem,
  stripControl,
  stripControlMultiline,
} from './forgeText'

// Build control bytes from codes so no literal control char lives in source.
const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const CR = String.fromCharCode(0x0d)
const TAB = String.fromCharCode(0x09)

describe('forge text sanitization (terminal-injection hardening)', () => {
  describe('stripControl', () => {
    it('removes ESC / CR / C0 / C1 control bytes but keeps printable text', () => {
      expect(stripControl(`${ESC}[2J${ESC}[31mhi${ESC}[0m`)).toBe('[2J[31mhi[0m')
      expect(stripControl(`line1${CR}\nline2`)).toBe('line1line2')
      expect(stripControl(`tab${TAB}here`)).toBe('tabhere')
      expect(stripControl('plain title')).toBe('plain title')
    })

    it('strips OSC clipboard-write sequences (no ESC, no BEL survive)', () => {
      const cleaned = stripControl(`${ESC}]52;c;ZXZpbA==${BEL}`)
      expect(cleaned).not.toContain(ESC)
      expect(cleaned).not.toContain(BEL)
      expect(cleaned).toBe(']52;c;ZXZpbA==')
    })

    it('keeps wide / unicode characters', () => {
      expect(stripControl('日本語 🚀')).toBe('日本語 🚀')
    })
  })

  describe('stripControlMultiline', () => {
    it('keeps newlines but strips ESC and other control bytes', () => {
      expect(stripControlMultiline(`para1${ESC}[31m\npara2`)).toBe('para1[31m\npara2')
    })
    it('normalizes CRLF / CR to LF', () => {
      expect(stripControlMultiline(`a${CR}\nb${CR}c`)).toBe('a\nb\nc')
    })
  })

  describe('view-model sanitizers', () => {
    it('strips control bytes from every rendered PR list field', () => {
      const out = sanitizePullRequestListItem({
        number: 1,
        title: `${ESC}[2JOwned`,
        url: `https://x/${ESC}`,
        state: 'OPEN',
        isDraft: false,
        headRefName: `feat/${ESC}[31m`,
        baseRefName: 'main',
        author: `al${ESC}ice`,
        assignees: [`bo${ESC}b`],
        labels: [`bu${ESC}g`],
        createdAt: 't',
        updatedAt: 't',
      })
      expect(out.title).toBe('[2JOwned')
      expect(out.url).toBe('https://x/')
      expect(out.headRefName).toBe('feat/[31m')
      expect(out.author).toBe('alice')
      expect(out.assignees).toEqual(['bob'])
      expect(out.labels).toEqual(['bug'])
    })

    it('strips control bytes from issue list fields', () => {
      const out = sanitizeIssueListItem({
        number: 2,
        title: `${ESC}]0;evil`,
        url: 'https://x',
        state: 'OPEN',
        author: `${ESC}x`,
        labels: [`${ESC}l`],
        createdAt: 't',
        updatedAt: 't',
      })
      expect(out.title).not.toContain(ESC)
      expect(out.author).toBe('x')
      expect(out.labels).toEqual(['l'])
    })

    it('strips PR detail body/comments/reviews while preserving newlines in bodies', () => {
      const out = sanitizePullRequestDetail({
        number: 3,
        body: `line1${ESC}[31m\nline2`,
        comments: [{ author: `${ESC}a`, body: `c${ESC}1`, createdAt: 't' }],
        reviews: [{ author: `${ESC}r`, state: 'APPROVED', body: `${ESC}ok`, submittedAt: 't' }],
        statusCheckRollup: [],
      })
      expect(out.body).toBe('line1[31m\nline2')
      expect(out.comments[0]).toEqual({ author: 'a', body: 'c1', createdAt: 't' })
      expect(out.reviews[0]).toEqual({ author: 'r', state: 'APPROVED', body: 'ok', submittedAt: 't' })
    })

    it('strips issue detail body + comments', () => {
      const out = sanitizeIssueDetail({
        number: 4,
        body: `${ESC}[2Jhi`,
        comments: [{ author: 'a', body: `x${ESC}y`, createdAt: 't' }],
      })
      expect(out.body).toBe('[2Jhi')
      expect(out.comments[0].body).toBe('xy')
    })
  })
})
