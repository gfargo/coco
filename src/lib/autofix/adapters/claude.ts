import { spawn } from 'child_process'
import { BaseAdapter, AutoFixVendor } from '../types'

export class ClaudeAdapter implements BaseAdapter {
  readonly vendor: AutoFixVendor = 'anthropic'
  readonly envVar = 'ANTHROPIC_API_KEY'

  async run(prompt: string, options?: Record<string, string>, apiKey?: string): Promise<void> {
    const args: string[] = ['--print']

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        args.push(`--${key}`, value)
      }
    }

    args.push(prompt)

    // Preserve the caller's environment.  Only set the API key when an
    // explicit non-empty key is provided AND the ambient variable is not
    // already populated — never clobber a valid working credential.
    const env = { ...process.env }
    if (apiKey && !env[this.envVar]) {
      env[this.envVar] = apiKey
    }

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, { stdio: 'inherit', env })

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
