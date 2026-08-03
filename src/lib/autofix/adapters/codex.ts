import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'

export class CodexAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'openai'
  readonly envVar = 'OPENAI_API_KEY'

  async run(prompt: string, options?: Record<string, string>, apiKey?: string): Promise<void> {
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

    // Preserve the caller's environment.  Only set the API key when an
    // explicit non-empty key is provided AND the ambient variable is not
    // already populated — never clobber a valid working credential.
    const env = { ...process.env }
    if (apiKey && !env[this.envVar]) {
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
