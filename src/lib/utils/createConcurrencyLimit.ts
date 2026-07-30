import PQueue from 'p-queue'

export type Limit = <T>(operation: () => Promise<T>) => Promise<T>

/**
 * Bounded-concurrency limiter backed by p-queue. Runs at most
 * `maxConcurrent` operations at once; the rest queue FIFO. Replaces the
 * hand-rolled semaphores previously duplicated across the default parser,
 * one of which had an over-admission race (the `active >= limit` check
 * wasn't re-checked after a waiter woke up).
 */
export function createConcurrencyLimit(maxConcurrent: number): Limit {
  const queue = new PQueue({ concurrency: Math.max(1, maxConcurrent) })
  return <T>(operation: () => Promise<T>): Promise<T> =>
    queue.add(operation) as Promise<T>
}
