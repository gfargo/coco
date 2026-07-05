import { randomBytes } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'

/**
 * Write `data` to `file` atomically via tmp+rename. The tmp name carries a
 * random suffix (not the predictable `process.pid`) and is created 0600 with
 * O_EXCL (`wx`) so a symlink/clobber can't be planted at a guessable path
 * ahead of the write. Caller must catch — write failures (e.g. read-only
 * dir) propagate as thrown errors, matching `writeFileSync`/`renameSync`.
 */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' })
  renameSync(tmp, file)
}
