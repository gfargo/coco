/**
 * PTY end-to-end harness (#1424).
 *
 * Drives the REAL workstation TUI — the built `dist/index.js` bundle —
 * inside a pseudo-terminal, so the interactive Ink path is exercised
 * end-to-end: raw-mode stdin → input dispatcher → reducers → renderers →
 * ANSI output. The unit suite covers each of those layers in isolation;
 * this harness covers the seams between them, where most of the July
 * audit's dispatch bugs lived.
 *
 * Output is fed into a headless xterm.js terminal emulator so tests can
 * snapshot the rendered screen as plain text and assert on it — the same
 * "what the user actually sees" surface VHS captures as pixels, but fast
 * and diffable in CI.
 *
 * Determinism levers (mirroring bin/screenshot/tape.ts):
 *   - COCO_SNAPSHOT_NOW freezes the render clock (spinners/tips suppress)
 *   - NO_COLOR strips theme colors so snapshots are stable text
 *   - HOME points at a throwaway dir so the user's ~/.coco config and
 *     global gitconfig cannot leak into a run
 */
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { IPty } from 'node-pty'
import type { Terminal } from '@xterm/headless'

/** Frozen render clock — same instant the screenshot pipeline pins. */
export const E2E_SNAPSHOT_NOW = '2026-05-27T12:00:00Z'

const REPO_ROOT = path.resolve(__dirname, '..')
const DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js')

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 35

/**
 * Yarn 1 does not preserve file modes for files inside published
 * tarballs, so node-pty's prebuilt `spawn-helper` lands without its
 * execute bit and every spawn fails with `posix_spawnp failed`.
 * Restore the bit before first use; no-op elsewhere.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return
  const ptyRoot = path.dirname(
    path.dirname(require.resolve('node-pty/package.json'))
  )
  const helper = path.join(
    ptyRoot,
    'node-pty',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper'
  )
  if (!fs.existsSync(helper)) return
  try {
    fs.accessSync(helper, fs.constants.X_OK)
  } catch {
    fs.chmodSync(helper, 0o755)
  }
}

/** Named keys → the raw bytes a terminal sends for them. */
const KEY_BYTES: Record<string, string> = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  space: ' ',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  'ctrl+c': '\x03',
  'ctrl+u': '\x15',
}

export interface TuiSessionOptions {
  /** Working directory the TUI starts in (usually a fixture repo). */
  cwd: string
  /** CLI argv after the entry point. Defaults to the workstation (`ui`). */
  args?: string[]
  cols?: number
  rows?: number
  /** Extra environment on top of the deterministic baseline. */
  env?: Record<string, string>
}

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

// 30s was too tight under real CI contention: main-broken-alert (#1564)
// caught a run where searchFilter.e2e.test.ts timed out twice waiting on
// keystroke round-trips on a noisy shared runner (83s total vs. 22s on
// the PR's own quieter run) — the TUI was still alive and responsive,
// just slow to paint. 45s gives real headroom while jest's per-file
// testTimeout (120s in jest.e2e.config.ts) still bounds the worst case.
const DEFAULT_WAIT: Required<WaitOptions> = { timeoutMs: 45_000, intervalMs: 50 }

/**
 * One live TUI process in a PTY plus the emulated screen it draws on.
 * Construct via {@link launchTui}; always `close()` in `finally`/afterEach.
 */
export class TuiSession {
  private readonly pty: IPty
  private readonly term: Terminal
  private readonly tempHome: string
  private pendingWrites = 0
  private exitResult: { exitCode: number } | null = null
  private exitWaiters: Array<(code: number) => void> = []

  private constructor(pty: IPty, term: Terminal, tempHome: string) {
    this.pty = pty
    this.term = term
    this.tempHome = tempHome
    this.pty.onData((data) => {
      this.pendingWrites += 1
      this.term.write(data, () => {
        this.pendingWrites -= 1
      })
    })
    this.pty.onExit(({ exitCode }) => {
      this.exitResult = { exitCode }
      const waiters = this.exitWaiters
      this.exitWaiters = []
      for (const resolve of waiters) resolve(exitCode)
    })
  }

  static async launch(options: TuiSessionOptions): Promise<TuiSession> {
    if (!fs.existsSync(DIST_ENTRY)) {
      throw new Error(
        `dist/index.js not found — the e2e harness drives the built bundle. Run \`npm run build\` first.`
      )
    }
    ensureSpawnHelperExecutable()

    const cols = options.cols ?? DEFAULT_COLS
    const rows = options.rows ?? DEFAULT_ROWS

    // Throwaway HOME: isolates ~/.coco config, and gives git a clean
    // global config with just enough identity to commit from the TUI.
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-e2e-home-'))
    fs.writeFileSync(
      path.join(tempHome, '.gitconfig'),
      [
        '[user]',
        '\tname = Coco E2E',
        '\temail = e2e@git-co.co',
        '[init]',
        '\tdefaultBranch = main',
        '[commit]',
        '\tgpgsign = false',
        '',
      ].join('\n')
    )
    // Pre-seed the once-per-machine onboarding marker (see
    // src/workstation/chrome/onboarding.ts) — with a fresh HOME every
    // launch would otherwise open on the welcome overlay.
    const onboardingDir = path.join(tempHome, '.cache', 'coco')
    fs.mkdirSync(onboardingDir, { recursive: true })
    fs.writeFileSync(path.join(onboardingDir, 'onboarding.seen'), '')

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: tempHome,
      TERM: 'xterm-256color',
      COCO_SNAPSHOT_NOW: E2E_SNAPSHOT_NOW,
      NO_COLOR: '1',
      // Ink detects CI (is-in-ci) and then skips live rendering, emitting
      // only a final frame at unmount — which would blind this harness.
      // GitHub Actions sets CI=true, so force it off; '0' is the one
      // value is-in-ci treats as definitively "not CI".
      CI: '0',
      ...options.env,
    }

    // Both imports are lazy so merely loading this module (e.g. for the
    // key table) never touches the native addon.
    const { spawn } = (await import('node-pty')) as typeof import('node-pty')
    const { Terminal } = (await import(
      '@xterm/headless'
    )) as typeof import('@xterm/headless')

    const term = new Terminal({ cols, rows, allowProposedApi: true })
    const child = spawn(
      process.execPath,
      [DIST_ENTRY, ...(options.args ?? ['ui'])],
      { name: 'xterm-256color', cols, rows, cwd: options.cwd, env }
    )
    return new TuiSession(child, term, tempHome)
  }

  /** The rendered screen as trimmed plain-text lines, top to bottom. */
  snapshot(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let y = 0; y < this.term.rows; y++) {
      const line = buffer.getLine(buffer.baseY + y)
      lines.push(line ? line.translateToString(true) : '')
    }
    // Drop trailing blank rows so assertions and failure dumps stay tight.
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  /** Type literal text (each character as-is, no key translation). */
  type(text: string): void {
    this.pty.write(text)
  }

  /**
   * Press named keys in order — `press('g', 's')`, `press('escape')`.
   * Single characters pass through; named keys use {@link KEY_BYTES}.
   */
  press(...keys: string[]): void {
    for (const key of keys) {
      const bytes = KEY_BYTES[key.toLowerCase()]
      if (bytes !== undefined) {
        this.pty.write(bytes)
      } else if (key.length === 1) {
        this.pty.write(key)
      } else {
        throw new Error(`Unknown key name: ${JSON.stringify(key)}`)
      }
    }
  }

  /**
   * Poll the screen until `matcher` appears (string containment or
   * regex test). Rejects with the final screen contents on timeout so
   * failures are debuggable from CI logs alone.
   */
  async waitForText(matcher: string | RegExp, options?: WaitOptions): Promise<string> {
    return this.waitFor(
      (screen) =>
        typeof matcher === 'string' ? screen.includes(matcher) : matcher.test(screen),
      `screen to match ${matcher}`,
      options
    )
  }

  /** Poll until `predicate(screen)` holds; resolves with that screen. */
  async waitFor(
    predicate: (screen: string) => boolean,
    description: string,
    options?: WaitOptions
  ): Promise<string> {
    const { timeoutMs, intervalMs } = { ...DEFAULT_WAIT, ...options }
    const deadline = Date.now() + timeoutMs
    let screen = ''
    while (Date.now() < deadline) {
      screen = this.snapshot()
      if (this.pendingWrites === 0 && predicate(screen)) return screen
      await delay(intervalMs)
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${description}.\n` +
        `Process ${this.exitResult ? `exited with code ${this.exitResult.exitCode}` : 'still running'}.\n` +
        `--- last screen ---\n${screen}\n-------------------`
    )
  }

  /**
   * Wait until the TUI is fully interactive: the requested anchor text
   * is on screen, no `· loading …` chip remains in the header, and the
   * screen has stopped repainting. Keystrokes sent during the boot
   * stages (cache paint → mount → background refresh) are dropped by
   * the not-yet-mounted dispatcher, so every journey must gate on this
   * before its first keypress.
   */
  async waitForReady(anchor: string | RegExp = 'q quit', options?: WaitOptions): Promise<string> {
    await this.waitFor(
      (screen) =>
        (typeof anchor === 'string' ? screen.includes(anchor) : anchor.test(screen)) &&
        !screen.includes('· loading'),
      `TUI ready (anchor ${anchor}, no loading chip)`,
      options
    )
    return this.waitForIdle(400, options)
  }

  /**
   * Wait until the screen stops changing for `settleMs` — useful after
   * a keystroke whose result has no single anchor string.
   */
  async waitForIdle(settleMs = 300, options?: WaitOptions): Promise<string> {
    const { timeoutMs } = { ...DEFAULT_WAIT, ...options }
    const deadline = Date.now() + timeoutMs
    let previous = this.snapshot()
    let stableSince = Date.now()
    while (Date.now() < deadline) {
      await delay(50)
      const current = this.snapshot()
      if (current !== previous || this.pendingWrites > 0) {
        previous = current
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= settleMs) {
        return current
      }
    }
    return previous
  }

  async waitForExit(timeoutMs = 10_000): Promise<number> {
    if (this.exitResult) return this.exitResult.exitCode
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Process did not exit within ${timeoutMs}ms`)),
        timeoutMs
      )
      this.exitWaiters.push((code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
  }

  get exited(): boolean {
    return this.exitResult !== null
  }

  /**
   * Quit cleanly via `q` when possible, escalate to SIGTERM/SIGKILL if
   * the process lingers, then release the emulator and temp HOME.
   */
  async close(): Promise<void> {
    try {
      if (!this.exitResult) {
        this.press('q')
        await this.waitForExit(5_000).catch(() => {
          this.pty.kill('SIGTERM')
          return this.waitForExit(3_000).catch(() => this.pty.kill('SIGKILL'))
        })
      }
    } finally {
      this.term.dispose()
      fs.rmSync(this.tempHome, { recursive: true, force: true })
    }
  }
}

/** Launch the workstation TUI in a PTY. See {@link TuiSessionOptions}. */
export async function launchTui(options: TuiSessionOptions): Promise<TuiSession> {
  return TuiSession.launch(options)
}

/**
 * Sanity-check that the fixture repo is a git repo — catches scenario
 * regressions with a clear message instead of a TUI boot failure.
 */
export function assertGitRepo(repoPath: string): void {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'pipe' })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
