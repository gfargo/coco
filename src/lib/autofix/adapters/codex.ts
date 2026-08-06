import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'

export class CodexAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'openai'
  readonly envVar = 'OPENAI_API_KEY'

  async run(
    prompt: string,
    options?: Record<string, string>,
    apiKey?: string,
    forceApiKey?: string
  ): Promise<void> {
    const args: string[] = ['exec']

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (key === 'model' || key === 'm') {
          args.push('--model', value)
        } else if (key === 'sandbox' || key === 's') {
          args.push('--sandbox', value)
        } else {
          args.push('-c', `${key}=${value}`)
        }
      }
    }

    args.push('--full-auto', prompt)

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
      const child = spawn('codex', args, { stdio: 'inherit', env })

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
