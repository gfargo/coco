import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'
import { filterAllowedOptions } from '../optionAllowlist'

/**
 * Tuning flags this adapter forwards to `gemini`. Deliberately excludes
 * `--yolo` (auto-accepts every action, no confirmation) and `--approval-mode`
 * when set to its `yolo` value — the exact class of flag #1840 is about
 * keeping out of autoFixToolOptions. `sandbox` stays allowed: it's a real
 * tuning knob (and can also *restrict* execution), not solely a bypass.
 */
const ALLOWED_OPTIONS = new Set(['model', 'sandbox', 'checkpointing'])

export class GeminiAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'google'
  readonly envVar = 'GEMINI_API_KEY'
  readonly binary = 'gemini'

  buildArgs(options?: Record<string, string>): string[] {
    const args: string[] = []

    const allowedOptions = filterAllowedOptions(options, ALLOWED_OPTIONS, 'gemini')
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
              'gemini binary not found. Please install Gemini CLI: https://ai.google.dev/gemini-api/docs/quickstart'
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
          reject(new Error(`gemini exited with code ${code}`))
        }
      })
    })
  }
}
