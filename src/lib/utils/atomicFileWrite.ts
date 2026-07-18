import { randomBytes } from 'node:crypto'
import { chmodSync, renameSync, statSync, writeFileSync } from 'node:fs'

export type WriteFileAtomicOptions = {
  /**
   * When true, the final file mode matches the destination's existing mode
   * (or `0o666 & ~umask` if the destination doesn't exist yet) instead of
   * the default 0600. Use for public/shared files (e.g. CHANGELOG.md) where
   * silently downgrading to owner-only would break other readers.
   */
  preserveExistingMode?: boolean
}

/**
 * Write `data` to `file` atomically via tmp+rename. The tmp name carries a
 * random suffix (not the predictable `process.pid`) and is created 0600 with
 * O_EXCL (`wx`) so a symlink/clobber can't be planted at a guessable path
 * ahead of the write. Caller must catch — write failures (e.g. read-only
 * dir) propagate as thrown errors, matching `writeFileSync`/`renameSync`.
 *
 * By default the final file is 0600 (rename preserves the tmp's mode) —
 * right for the private caches/config this was built for. Pass
 * `{ preserveExistingMode: true }` for files that should keep their
 * existing (or umask-derived) mode instead.
 */
export function writeFileAtomic(file: string, data: string, options: WriteFileAtomicOptions = {}): void {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' })
  if (options.preserveExistingMode) {
    let mode: number
    try {
      mode = statSync(file).mode & 0o777
    } catch {
      mode = 0o666 & ~process.umask()
    }
    chmodSync(tmp, mode)
  }
  renameSync(tmp, file)
}
