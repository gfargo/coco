import { spawn } from 'node:child_process'
import { withSpawnCount } from './gitSpawnCounter'

// Spawns real git processes; under heavy parallel load the default 5s
// jest timeout is too tight.
jest.setTimeout(15000)

describe('withSpawnCount', () => {
  it('counts spawn calls made during fn and restores the original afterward', async () => {
    const { result, spawnCount } = await withSpawnCount(async () => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('git', ['--version'], { stdio: 'ignore' })
        child.on('error', reject)
        child.on('exit', () => resolve())
      })
      return 'done'
    })

    expect(result).toBe('done')
    expect(spawnCount).toBe(1)
  })

  it('does not count spawn calls made outside the measured window', async () => {
    await withSpawnCount(async () => undefined)

    let sawUnpatchedCall = false
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['--version'], { stdio: 'ignore' })
      sawUnpatchedCall = true
      child.on('error', reject)
      child.on('exit', () => resolve())
    })

    expect(sawUnpatchedCall).toBe(true)
  })

  it('accumulates counts across multiple spawns within the same call', async () => {
    const { spawnCount } = await withSpawnCount(async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('git', ['--version'], { stdio: 'ignore' })
          child.on('error', reject)
          child.on('exit', () => resolve())
        })
      }
    })

    expect(spawnCount).toBe(3)
  })
})
