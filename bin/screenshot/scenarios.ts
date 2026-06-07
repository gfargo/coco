/**
 * Custom screenshot-only git scenarios, registered into the
 * `@gfargo/git-scenarios` registry so recipes can reference them by
 * name just like the built-ins. Importing this module performs the
 * registration as a side effect; `bin/screenshot.ts` imports it once
 * at startup, before any `fromScenario` / `listRegistered` call.
 */
import {
  addCommit,
  chain,
  checkoutBranch,
  createBranch,
  defineScenario,
  listRegistered,
  registerScenario,
} from '@gfargo/git-scenarios'

// A recognizable JavaScript module before/after a real refactor, so the
// diff view has plenty of syntax to highlight (keywords, strings,
// comments, JSDoc, template literals) across added, removed, and
// changed lines. Backs the `view-diff.png` marketing shot.
const RATE_LIMITER_BEFORE = `// In-memory rate limiter.
// Tracks request counts per key within a single fixed time window.

const WINDOW_MS = 60_000
const MAX_REQUESTS = 100

const buckets = new Map()

function hit(key) {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 })
    return { allowed: true, remaining: MAX_REQUESTS - 1 }
  }

  bucket.count += 1
  const remaining = MAX_REQUESTS - bucket.count
  return { allowed: remaining >= 0, remaining: Math.max(remaining, 0) }
}

function reset(key) {
  buckets.delete(key)
}

module.exports = { hit, reset }
`

const RATE_LIMITER_AFTER = `// Sliding-window rate limiter.
// Smooths the burst a fixed window allows at the boundary by weighting
// the previous window's count by how far we are into the current one.

const DEFAULTS = {
  windowMs: 60_000,
  max: 100,
}

/**
 * Create a rate limiter backed by its own bucket store.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs] Length of the window, in ms.
 * @param {number} [options.max] Requests allowed per window.
 * @returns {{ hit: (key: string) => Result, reset: (key: string) => void }}
 */
function createRateLimiter(options = {}) {
  const { windowMs, max } = { ...DEFAULTS, ...options }
  const buckets = new Map()

  function hit(key) {
    const now = Date.now()
    const slot = Math.floor(now / windowMs)
    const bucket = buckets.get(key) ?? { slot, current: 0, previous: 0 }

    if (slot !== bucket.slot) {
      bucket.previous = slot === bucket.slot + 1 ? bucket.current : 0
      bucket.current = 0
      bucket.slot = slot
    }

    const elapsed = (now % windowMs) / windowMs
    const weighted = bucket.previous * (1 - elapsed) + bucket.current

    if (weighted >= max) {
      buckets.set(key, bucket)
      return { allowed: false, remaining: 0, retryAfter: windowMs - (now % windowMs) }
    }

    bucket.current += 1
    buckets.set(key, bucket)
    return { allowed: true, remaining: Math.max(0, Math.floor(max - weighted - 1)) }
  }

  function reset(key) {
    buckets.delete(key)
  }

  return { hit, reset }
}

module.exports = { createRateLimiter, DEFAULTS }
`

const README = `# api-gateway

Edge service for the public API. See \`src/rate-limiter.js\` for the
request-budgeting logic.
`

// Registration is idempotent across repeated imports in one process.
if (!listRegistered().some((entry) => entry.name === 'diff-js-showcase')) {
  registerScenario(
    defineScenario({
      name: 'diff-js-showcase',
      summary: 'Feature branch refactoring a JavaScript module — rich syntax-highlighted diff',
      description:
        'A clean feature branch whose tip commit rewrites src/rate-limiter.js from a ' +
        'fixed-window to a sliding-window implementation. Used for the side-by-side diff ' +
        'marketing screenshot so it shows substantial JS highlighting.',
      kind: 'branch',
      setup: chain(
        addCommit({
          message: 'feat: add fixed-window rate limiter',
          files: { 'README.md': README, 'src/rate-limiter.js': RATE_LIMITER_BEFORE },
        }),
        createBranch('feature/sliding-window'),
        checkoutBranch('feature/sliding-window'),
        addCommit({
          message: 'refactor(rate-limiter): switch to a sliding-window algorithm',
          files: { 'src/rate-limiter.js': RATE_LIMITER_AFTER },
        }),
      ),
    })
  )
}
