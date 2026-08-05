import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'

export class GeminiAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'google'
  readonly envVar = 'GEMINI_API_KEY'

  async run(
    prompt: string,
    options?: Record<string, string>,
    apiKey?: string,
    forceApiKey?: string
  ): Promise<void> {
    const args: string[] = []

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        args.push(`--${key}`, value)
      }
    }

    args.push(prompt)

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
      const child = spawn('gemini', args, { stdio: 'inherit', env })

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
