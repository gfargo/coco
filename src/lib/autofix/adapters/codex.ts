import { spawn } from 'child_process'
import { BaseAdapter } from '../types'

export class CodexAdapter implements BaseAdapter {
  async run(prompt: string, options?: Record<string, string>): Promise<void> {
    const args: string[] = []

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        args.push(`--${key}`, value)
      }
    }

    args.push(prompt)

    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        stdio: 'inherit',
        env: process.env,
      })

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
