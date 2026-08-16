import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'
import { filterAllowedOptions } from '../optionAllowlist'

/** Keys mapped to a named codex CLI flag rather than a `-c` config override. */
const DIRECT_FLAG_OPTIONS = new Set(['model', 'm', 'sandbox', 's'])

/**
 * Keys still allowed through to codex's `-c key=value` config-override
 * mechanism. This used to be every unrecognized key — an unbounded escape
 * hatch that let a config value write directly into codex's config
 * namespace, including keys that disable its own approval/sandbox gates
 * (#1840). Only `approval-mode` is allowlisted; anything else is dropped by
 * `filterAllowedOptions` before this file ever sees it.
 */
const CONFIG_OVERRIDE_OPTIONS = new Set(['approval-mode'])

const ALLOWED_OPTIONS = new Set([...DIRECT_FLAG_OPTIONS, ...CONFIG_OVERRIDE_OPTIONS])

export class CodexAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'openai'
  readonly envVar = 'OPENAI_API_KEY'
  readonly binary = 'codex'

  buildArgs(options?: Record<string, string>): string[] {
    const args: string[] = ['exec']

    const allowedOptions = filterAllowedOptions(options, ALLOWED_OPTIONS, 'codex')
    if (allowedOptions) {
      for (const [key, value] of Object.entries(allowedOptions)) {
        if (key === 'model' || key === 'm') {
          args.push('--model', value)
        } else if (key === 'sandbox' || key === 's') {
          args.push('--sandbox', value)
        } else {
          // Only CONFIG_OVERRIDE_OPTIONS entries reach here — everything
          // else was already dropped by filterAllowedOptions above.
          args.push('-c', `${key}=${value}`)
        }
      }
    }

    args.push('--full-auto')
    return args
  }

  async run(
    prompt: string,
    options?: Record<string, string>,
    apiKey?: string,
    forceApiKey?: string
  ): Promise<void> {
    const args = [...this.buildArgs(options), prompt]

    // Build the child environment:
    //   - forceApiKey (explicit per-tool credential) always wins, even if an
    //     ambient variable is already set — the user explicitly chose this key.
    //   - apiKey (derived from coco's provider) is only injected when the
    //     ambient variable is absent — never clobber a working credential.
    const env = { ...process.env }
    if (forceApiKey) {
      env[this.envVar] = forceApiKey
    } else if (apiKey && !env[this.envVar]) {
      env[this.envVar] = apiKey
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: 'inherit', env })

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(new Error('codex binary not found. Please install it: npm i -g @openai/codex'))
        } else {
          reject(err)
        }
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`codex exited with code ${code}`))
        }
      })
    })
  }
}
