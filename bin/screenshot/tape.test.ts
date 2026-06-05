/**
 * Secret redaction for the screenshot harness.
 *
 * The VHS tape embeds `Type "export OPENAI_API_KEY=…"` lines so the
 * in-VHS shell can make real LLM / GitHub calls for demo captures, and
 * VHS echoes every command it runs to stdout. `createSecretRedactor`
 * masks those forwarded values before the driver surfaces VHS output so
 * live keys/tokens never reach the logs.
 */
import { createSecretRedactor, hasForwardedSecrets } from './tape'

const SECRET_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
]

describe('createSecretRedactor', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of SECRET_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of SECRET_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('masks forwarded secret values wherever they appear', () => {
    process.env.OPENAI_API_KEY = 'sk-proj-abcdefghijklmnop1234567890'
    process.env.GH_TOKEN = 'gho_ABCDEFGHIJKLMNOP1234567890'
    const redact = createSecretRedactor()

    const line = `Type "export OPENAI_API_KEY=${process.env.OPENAI_API_KEY}"\nType "export GH_TOKEN=${process.env.GH_TOKEN}"`
    const out = redact(line)

    expect(out).not.toContain('sk-proj-abcdefghijklmnop1234567890')
    expect(out).not.toContain('gho_ABCDEFGHIJKLMNOP1234567890')
    expect(out).toContain('OPENAI_API_KEY=[redacted]')
    expect(out).toContain('GH_TOKEN=[redacted]')
  })

  it('is an identity function when nothing sensitive is set', () => {
    const redact = createSecretRedactor()
    const text = 'Type "export OLLAMA_HOST=localhost"\nSleep 100ms'
    expect(redact(text)).toBe(text)
  })

  it('leaves short, non-secret values alone (no over-masking)', () => {
    // A short value (< 8 chars) shouldn't be treated as a secret — it
    // would otherwise blank out incidental substrings of the log.
    process.env.GH_TOKEN = 'short'
    const redact = createSecretRedactor()
    expect(redact('the short straw and a shortcut')).toBe('the short straw and a shortcut')
  })

  it('masks a value that is a substring of a longer one in full', () => {
    process.env.OPENAI_API_KEY = 'sk-aaaaaaaa'
    process.env.GH_TOKEN = 'sk-aaaaaaaa-extended-suffix'
    const redact = createSecretRedactor()
    const out = redact(`a=${process.env.GH_TOKEN} b=${process.env.OPENAI_API_KEY}`)
    expect(out).toBe('a=[redacted] b=[redacted]')
  })
})

describe('hasForwardedSecrets', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Clear every forwarded key — the real env (or a loaded .env) may
    // already have some set, which would mask the assertions below.
    for (const key of SECRET_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of SECRET_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('is true when a forwarded key holds a secret-length value', () => {
    process.env.OPENAI_API_KEY = 'sk-proj-longenoughvalue'
    expect(hasForwardedSecrets()).toBe(true)
  })

  it('is false when only short values are set', () => {
    process.env.OPENAI_API_KEY = 'tiny'
    expect(hasForwardedSecrets()).toBe(false)
  })
})
