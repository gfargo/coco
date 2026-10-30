/**
 * "Latest request wins" gate for the workspace overview loads (#2210).
 * `refresh`, `confirmDelete`, `commitAddRepo`, `commitClone` and the
 * mount load all call `loadOverview` with no coordination, so whichever
 * finished LAST won, even when it was the older request, and a stale
 * batch's cleanup (`set-pull-request-fetching []`) cleared the newer
 * batch's spinners. Each load calls `begin()` before awaiting and checks
 * the returned predicate after; a newer `begin()` makes every older
 * predicate false.
 */
export function createLatestGate(): { begin: () => () => boolean } {
  let generation = 0
  return {
    begin() {
      generation += 1
      const mine = generation
      return () => mine === generation
    },
  }
}
