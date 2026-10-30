/**
 * Shared failure handling for the git action modules, so a lock collision
 * or a blocked credential prompt reads the same wherever it surfaces.
 */

// Lock-file contention in any of its wordings: the index (`index.lock`),
// a ref or other lock file (`Unable to create '...lock'`), and config
// writes (`could not lock config file ...: File exists`). A ref RACE
// ("cannot lock ref ... is at X but expected Y") is deliberately not here:
// retrying that would just repeat a lost compare-and-swap.
const INDEX_LOCK_PATTERN = /index\.lock|Unable to create '[^']*\.lock'|could not lock config file/i
const AUTH_FAILURE_PATTERN =
  /terminal prompts disabled|could not read (?:Username|Password)|Authentication failed|Permission denied \(publickey|Host key verification failed|No supported authentication methods|passphrase|Enter PIN/i

const LOCK_RETRY_DELAYS_MS = [150, 450]

export function isIndexLockError(message: string | undefined): boolean {
  return INDEX_LOCK_PATTERN.test(message || '')
}

export function isGitAuthFailure(message: string | undefined): boolean {
  return AUTH_FAILURE_PATTERN.test(message || '')
}

/**
 * Runs `action`, retrying a couple of times with backoff when git fails
 * because another process holds `index.lock` (#2201). Git fails before
 * changing anything when it can't take the lock, so the retry is safe for
 * mutations. Any other error, or a lock that outlasts the retries, is
 * rethrown unchanged.
 */
export async function retryOnIndexLock<T>(
  action: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      const delay = LOCK_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !isIndexLockError((error as Error).message)) {
        throw error
      }
      await sleep(delay)
    }
  }
}

/**
 * Appends a next-step hint when a failure is a credential or host-key
 * prompt the TUI could not show (#2199).
 */
export function withAuthHint(message: string): string {
  return isGitAuthFailure(message)
    ? `${message}\nCoco can't answer git's prompts. Run the command once in a shell to authenticate (git push / git pull), then retry.`
    : message
}
