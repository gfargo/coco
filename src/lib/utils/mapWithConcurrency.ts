/**
 * Run `fn` over each input with at most `limit` workers in flight.
 * Preserves result order (results[i] corresponds to inputs[i]).
 *
 * Used by anywhere we want bounded-parallelism over a collection —
 * batches of `gh` calls, batches of `git` calls in the workspace
 * discovery loader, etc. Keeps the call-site free of manual queue
 * bookkeeping.
 */
export async function mapWithConcurrency<T, U>(
  inputs: ReadonlyArray<T>,
  limit: number,
  fn: (input: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = []
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(limit, inputs.length) },
    async () => {
      while (cursor < inputs.length) {
        const idx = cursor++
        results[idx] = await fn(inputs[idx])
      }
    }
  )
  await Promise.all(workers)
  return results
}
