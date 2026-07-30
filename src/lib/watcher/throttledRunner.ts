export type ThrottledRunnerScheduler = {
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

const DEFAULT_SCHEDULER: ThrottledRunnerScheduler = {
  // DevSkim: ignore DS172411
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export type ThrottledRunner = {
  /** Ask for a run. Coalesces with any in-flight or already-queued run. */
  trigger: () => void
  /** Cancel any pending cooldown timer without running. */
  close: () => void
}

/**
 * Rate-limits a settle-triggered operation (e.g. an LLM call) to at most
 * once per `minIntervalMs`, while never dropping the *last* request that
 * arrived during the cooldown — it fires once the cooldown clears. Also
 * prevents overlapping runs: a `trigger()` that arrives while `run()` is
 * still in flight is queued rather than started concurrently.
 *
 * This is the cost-containment guard for `coco watch`: a debounced fs
 * watcher can still fire a fresh settle every few hundred ms on a busy
 * repo, and without a floor on call frequency that's an LLM call per
 * keystroke-adjacent save.
 */
export function createThrottledRunner(
  minIntervalMs: number,
  run: () => Promise<void>,
  scheduler: ThrottledRunnerScheduler = DEFAULT_SCHEDULER,
): ThrottledRunner {
  let running = false
  let pending = false
  let lastRunAt = -Infinity
  let cooldownTimer: unknown = null

  const attempt = (): void => {
    if (running) {
      pending = true
      return
    }

    const elapsed = scheduler.now() - lastRunAt
    if (elapsed < minIntervalMs) {
      pending = true
      if (cooldownTimer === null) {
        cooldownTimer = scheduler.setTimeout(() => {
          cooldownTimer = null
          if (pending) {
            pending = false
            attempt()
          }
        }, minIntervalMs - elapsed)
      }
      return
    }

    running = true
    lastRunAt = scheduler.now()
    void run().finally(() => {
      running = false
      if (pending) {
        pending = false
        attempt()
      }
    })
  }

  const close = (): void => {
    if (cooldownTimer !== null) {
      scheduler.clearTimeout(cooldownTimer)
      cooldownTimer = null
    }
    pending = false
  }

  return { trigger: attempt, close }
}
