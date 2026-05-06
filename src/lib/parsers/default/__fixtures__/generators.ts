/**
 * Per-file-type content generators for the diff-condensing
 * benchmark fixtures (#845). Templates are seeded so the same
 * (target tokens, seed) pair produces identical content across
 * runs — required for apples-to-apples bench comparisons.
 *
 * Generators are deliberately simple: they produce content that
 * *looks* like code/docs (proper syntax, plausible identifiers,
 * realistic structure) without trying to be syntactically valid in
 * every detail. The goal is to feed the diff-condensing pipeline
 * input that resembles real-world diffs in shape and token mix —
 * not to produce executable artifacts.
 *
 * Token sizing uses a chars/4 approximation. The bench runner's
 * real tokenizer re-counts at fixture-load time, so the generators
 * only need to be in the right neighborhood.
 */

/** Seeded pseudo-random — LCG. Identical output for identical seed. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function pick<T>(rng: () => number, choices: ReadonlyArray<T>): T {
  return choices[Math.floor(rng() * choices.length) % choices.length]
}

function repeat(rng: () => number, min: number, max: number, fn: () => string): string[] {
  const count = min + Math.floor(rng() * (max - min + 1))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(fn())
  }
  return out
}

/** Append generators until the buffer hits the approximate char target. */
function buildToTarget(approxChars: number, generate: () => string): string {
  const parts: string[] = []
  let total = 0
  while (total < approxChars) {
    const part = generate()
    parts.push(part)
    total += part.length + 1
  }
  return parts.join('\n')
}

const IDENTIFIERS = [
  'value', 'result', 'item', 'entry', 'config', 'options', 'context', 'state',
  'handler', 'request', 'response', 'payload', 'session', 'token', 'cache',
  'manager', 'registry', 'observer', 'consumer', 'producer', 'parser', 'writer',
  'reader', 'logger', 'router', 'guard', 'visitor', 'validator', 'collector',
  'reducer', 'transformer', 'mapper', 'filter', 'selector', 'controller',
]

const TYPE_NAMES = [
  'User', 'Account', 'Order', 'Invoice', 'Product', 'Session', 'Profile',
  'Permission', 'Role', 'Resource', 'Event', 'Snapshot', 'Aggregate',
  'Message', 'Notification', 'Subscription', 'Document', 'Record', 'Entry',
  'Asset', 'Job', 'Task', 'Worker', 'Pipeline', 'Stage', 'Step', 'Outcome',
]

const FIELD_NAMES = [
  'id', 'name', 'email', 'createdAt', 'updatedAt', 'status', 'priority',
  'count', 'total', 'limit', 'offset', 'cursor', 'kind', 'type', 'value',
  'metadata', 'tags', 'notes', 'description', 'source', 'target', 'origin',
  'destination', 'enabled', 'disabled', 'archived', 'verified', 'pending',
]

const PROSE_WORDS = [
  'configuration', 'pipeline', 'consumer', 'producer', 'workflow', 'scheduler',
  'integration', 'authentication', 'authorization', 'persistence', 'request',
  'response', 'idempotent', 'deterministic', 'serializable', 'invalidation',
  'observability', 'instrumentation', 'reconciliation', 'orchestrator',
  'backpressure', 'throughput', 'latency', 'fanout', 'rollback', 'retry',
  'timeout', 'graceful', 'fallback', 'snapshot', 'partition', 'isolation',
  'cohesion', 'decoupling', 'extension', 'composition', 'invariant',
]

const PACKAGES_TS = [
  'react', 'react-dom', 'next', 'express', 'fastify', 'zod', 'yargs', 'chalk',
  'commander', 'inquirer', 'simple-git', '@langchain/core', '@langchain/openai',
  'jest', 'vitest', 'pino', 'winston', 'lodash', 'date-fns', 'tiktoken', 'ink',
]

const PACKAGES_PY = [
  'requests', 'pydantic', 'fastapi', 'click', 'rich', 'httpx', 'sqlalchemy',
  'pytest', 'beautifulsoup4', 'aiohttp', 'tenacity', 'structlog', 'numpy',
]

function sentence(rng: () => number, lengthWords = 0): string {
  const length = lengthWords || 6 + Math.floor(rng() * 12)
  const words: string[] = []
  for (let i = 0; i < length; i++) {
    words.push(pick(rng, PROSE_WORDS))
  }
  const joined = words.join(' ')
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.'
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

export function generateTypeScript(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const importBlock = repeat(rng, 3, 8, () => {
    const pkg = pick(rng, PACKAGES_TS)
    const ident = pick(rng, IDENTIFIERS)
    const named = pick(rng, [
      `import { ${pick(rng, FIELD_NAMES)}, ${pick(rng, FIELD_NAMES)} } from '${pkg}'`,
      `import ${ident} from '${pkg}'`,
      `import * as ${ident} from '${pkg}'`,
    ])
    return named
  }).join('\n')

  const body = buildToTarget(approxTokens * 4, () => {
    const choice = Math.floor(rng() * 5)
    if (choice === 0) {
      // type alias
      const name = pick(rng, TYPE_NAMES)
      const fields = repeat(rng, 3, 8, () => `  ${pick(rng, FIELD_NAMES)}: ${pick(rng, ['string', 'number', 'boolean', 'Date', 'string[]'])}`).join('\n')
      return `\nexport type ${name}${seed % 7} = {\n${fields}\n}\n`
    }
    if (choice === 1) {
      // function
      const name = pick(rng, IDENTIFIERS)
      const arg = pick(rng, FIELD_NAMES)
      const argType = pick(rng, TYPE_NAMES)
      const lines = repeat(rng, 4, 10, () => {
        const op = pick(rng, [
          `  const ${pick(rng, IDENTIFIERS)} = ${arg}.${pick(rng, FIELD_NAMES)}`,
          `  if (!${arg}) return null`,
          `  ${pick(rng, IDENTIFIERS)}.push(${pick(rng, IDENTIFIERS)})`,
          `  await ${pick(rng, IDENTIFIERS)}.${pick(rng, FIELD_NAMES)}()`,
          `  // ${sentence(rng, 5)}`,
        ])
        return op
      }).join('\n')
      return `\nexport async function ${name}${seed % 9}(${arg}: ${argType}) {\n${lines}\n  return ${arg}\n}\n`
    }
    if (choice === 2) {
      // class
      const name = pick(rng, TYPE_NAMES)
      const methods = repeat(rng, 2, 4, () => {
        const m = pick(rng, IDENTIFIERS)
        return `  ${m}(): void {\n    // ${sentence(rng, 6)}\n    return\n  }`
      }).join('\n\n')
      return `\nexport class ${name}${seed % 11} {\n${methods}\n}\n`
    }
    if (choice === 3) {
      // const declaration with object literal
      const name = pick(rng, IDENTIFIERS).toUpperCase()
      const fields = repeat(rng, 4, 8, () => `  ${pick(rng, FIELD_NAMES)}: '${pick(rng, PROSE_WORDS)}'`).join(',\n')
      return `\nconst ${name}_${seed % 13} = {\n${fields},\n} as const\n`
    }
    // jsdoc comment
    return `\n/**\n * ${sentence(rng)}\n * ${sentence(rng)}\n */\n`
  })

  return `${importBlock}\n${body}`
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export function generatePython(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const imports = repeat(rng, 3, 6, () => {
    const pkg = pick(rng, PACKAGES_PY)
    return pick(rng, [
      `import ${pkg}`,
      `from ${pkg} import ${pick(rng, FIELD_NAMES)}`,
      `from ${pkg} import ${pick(rng, FIELD_NAMES)}, ${pick(rng, FIELD_NAMES)}`,
    ])
  }).join('\n')

  const body = buildToTarget(approxTokens * 4, () => {
    const choice = Math.floor(rng() * 4)
    if (choice === 0) {
      // function
      const name = pick(rng, IDENTIFIERS)
      const arg = pick(rng, FIELD_NAMES)
      const lines = repeat(rng, 3, 8, () => {
        return pick(rng, [
          `    ${pick(rng, IDENTIFIERS)} = ${arg}.${pick(rng, FIELD_NAMES)}`,
          `    if not ${arg}:\n        return None`,
          `    ${pick(rng, IDENTIFIERS)}.append(${arg})`,
          `    # ${sentence(rng, 5)}`,
          `    logger.info("${pick(rng, PROSE_WORDS)}", extra={"${pick(rng, FIELD_NAMES)}": ${arg}})`,
        ])
      }).join('\n')
      return `\ndef ${name}_${seed % 7}(${arg}):\n    """${sentence(rng, 8)}"""\n${lines}\n    return ${arg}\n`
    }
    if (choice === 1) {
      // class
      const name = pick(rng, TYPE_NAMES)
      const methods = repeat(rng, 2, 4, () => {
        const m = pick(rng, IDENTIFIERS)
        return `    def ${m}(self):\n        """${sentence(rng, 6)}"""\n        return self.${pick(rng, FIELD_NAMES)}`
      }).join('\n\n')
      return `\nclass ${name}${seed % 11}:\n${methods}\n`
    }
    if (choice === 2) {
      // module-level constant / dict
      const name = pick(rng, IDENTIFIERS).toUpperCase()
      const lines = repeat(rng, 3, 6, () => `    "${pick(rng, FIELD_NAMES)}": "${pick(rng, PROSE_WORDS)}"`).join(',\n')
      return `\n${name}_${seed % 13} = {\n${lines},\n}\n`
    }
    // comment block
    return `\n# ${sentence(rng)}\n# ${sentence(rng)}\n`
  })

  return `${imports}\n${body}`
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function generateMarkdown(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const title = `# ${pick(rng, TYPE_NAMES)} ${pick(rng, PROSE_WORDS)}`
  const body = buildToTarget(approxTokens * 4, () => {
    const choice = Math.floor(rng() * 5)
    if (choice === 0) {
      const heading = pick(rng, ['##', '###'])
      return `\n${heading} ${pick(rng, PROSE_WORDS)} ${pick(rng, PROSE_WORDS)}\n`
    }
    if (choice === 1) {
      const items = repeat(rng, 3, 6, () => `- ${sentence(rng)}`).join('\n')
      return `\n${items}\n`
    }
    if (choice === 2) {
      return `\n\`\`\`ts\nconst ${pick(rng, IDENTIFIERS)} = ${pick(rng, IDENTIFIERS)}.${pick(rng, FIELD_NAMES)}\n\`\`\`\n`
    }
    if (choice === 3) {
      // table
      return `\n| ${pick(rng, FIELD_NAMES)} | ${pick(rng, FIELD_NAMES)} |\n|---|---|\n| ${pick(rng, PROSE_WORDS)} | ${pick(rng, PROSE_WORDS)} |\n`
    }
    return `\n${sentence(rng)} ${sentence(rng)}\n`
  })

  return `${title}\n${body}`
}

// ---------------------------------------------------------------------------
// JSON config
// ---------------------------------------------------------------------------

export function generateJson(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const sections = repeat(rng, 4, 10, () => {
    const fieldChoices = repeat(rng, 3, 8, () => {
      const v = Math.floor(rng() * 4)
      const value = v === 0
        ? `"${pick(rng, PROSE_WORDS)}-${seed}"`
        : v === 1
        ? `${Math.floor(rng() * 1000)}`
        : v === 2
        ? `[${repeat(rng, 1, 4, () => `"${pick(rng, IDENTIFIERS)}"`).join(', ')}]`
        : `${rng() < 0.5}`
      return `    "${pick(rng, FIELD_NAMES)}": ${value}`
    }).join(',\n')
    return `  "${pick(rng, IDENTIFIERS)}": {\n${fieldChoices}\n  }`
  }).join(',\n')

  const out = `{\n${sections}\n}\n`
  // Pad with extra entries until we hit the target so JSON sizing is
  // predictable per call.
  if (out.length < approxTokens * 4) {
    const extras = buildToTarget(approxTokens * 4 - out.length, () => {
      return `  "${pick(rng, IDENTIFIERS)}_${Math.floor(rng() * 10000)}": "${pick(rng, PROSE_WORDS)}"`
    })
    return out.replace(/\n}\n$/, `,\n${extras}\n}\n`)
  }
  return out
}

// ---------------------------------------------------------------------------
// YAML (CI workflow shape)
// ---------------------------------------------------------------------------

export function generateYaml(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const jobs = repeat(rng, 2, 5, () => {
    const name = pick(rng, IDENTIFIERS)
    const steps = repeat(rng, 3, 7, () => {
      return `      - name: ${pick(rng, PROSE_WORDS)} ${pick(rng, IDENTIFIERS)}\n        run: ${pick(rng, ['npm', 'pnpm', 'yarn'])} ${pick(rng, ['test', 'build', 'lint', 'check', 'install'])}`
    }).join('\n')
    return `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
  }).join('\n')

  const out = `name: ${pick(rng, PROSE_WORDS)}\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n${jobs}\n`

  if (out.length < approxTokens * 4) {
    const extras = buildToTarget(approxTokens * 4 - out.length, () => {
      return `  # ${sentence(rng, 6)}`
    })
    return `${out}\n${extras}`
  }
  return out
}

// ---------------------------------------------------------------------------
// Lockfile (npm-style)
// ---------------------------------------------------------------------------

export function generateLockfile(approxTokens: number, seed: number): string {
  const rng = seededRng(seed)
  const entries = buildToTarget(approxTokens * 4, () => {
    const pkg = pick(rng, PACKAGES_TS)
    const major = Math.floor(rng() * 20)
    const minor = Math.floor(rng() * 20)
    const patch = Math.floor(rng() * 30)
    return `  "${pkg}@${major}.${minor}.${patch}":\n    integrity: sha512-${seed}${pkg.length}${major}${minor}${patch}\n    dependencies:\n      "${pick(rng, PACKAGES_TS)}": "^${Math.floor(rng() * 10)}.0.0"`
  })
  return `# yarn lockfile v1\n\n${entries}`
}

// ---------------------------------------------------------------------------
// Dispatcher by extension
// ---------------------------------------------------------------------------

export function generateContentForFile(file: string, approxTokens: number, seed: number): string {
  const lower = file.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return generateTypeScript(approxTokens, seed)
  }
  if (lower.endsWith('.py')) {
    return generatePython(approxTokens, seed)
  }
  if (lower.endsWith('.md')) {
    return generateMarkdown(approxTokens, seed)
  }
  if (lower.endsWith('.json')) {
    return generateJson(approxTokens, seed)
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return generateYaml(approxTokens, seed)
  }
  if (lower.endsWith('.lock') || lower.includes('lockfile') || lower.endsWith('lock.json')) {
    return generateLockfile(approxTokens, seed)
  }
  // Default: TypeScript-shaped (most common in this codebase)
  return generateTypeScript(approxTokens, seed)
}
