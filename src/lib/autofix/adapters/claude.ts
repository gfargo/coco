import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'
import { filterAllowedOptions } from '../optionAllowlist'

/**
 * Tuning flags this adapter forwards to `claude --print`. Deliberately
 * excludes `--permission-mode` / `--dangerously-skip-permissions` — flags
 * whose entire purpose is disabling the CLI's own confirmation gates, the
 * exact class of flag #1840 is about keeping out of autoFixToolOptions.
 */
const ALLOWED_OPTIONS = new Set(['model', 'fallback-model', 'max-turns', 'output-format', 'append-system-prompt'])

export class ClaudeAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'anthropic'
  readonly envVar = 'ANTHROPIC_API_KEY'
  readonly binary = 'claude'

  buildArgs(options?: Record<string, string>): string[] {
    const args: string[] = ['--print']

    const allowedOptions = filterAllowedOptions(options, ALLOWED_OPTIONS, 'claude')
    if (allowedOptions) {
      for (const [key, value] of Object.entries(allowedOptions)) {
        args.push(`--${key}`, value)
      }
    }

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
          reject(
            new Error(
              'claude binary not found. Please install Claude Code: https://docs.anthropic.com/en/docs/claude-code'
            )
          )
        } else {
          reject(err)
        }
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`claude exited with code ${code}`))
        }
      })
    })
  }
}
