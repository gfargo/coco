/**
 * #2208 — `extendGraphLayout` resumes a layout when commits are appended,
 * instead of laying everything out again on every 1000-commit page. Its
 * output must be indistinguishable from a full `computeGraphLayout`.
 * Checked differentially against random histories split at random points.
 */
import { computeGraphLayout, extendGraphLayout, type LayoutCommit } from './graphLayout'

/** Small seeded PRNG so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * Random newest-first history: each commit's parents are drawn from older
 * commits, with merges, multiple roots and parents outside the list
 * (unloaded history), which is what a paged `git log` window looks like.
 */
function randomHistory(seed: number, count: number): LayoutCommit[] {
  const next = rng(seed)
  const hashes = Array.from({ length: count }, (_, i) => `c${seed}-${i}`)
  return hashes.map((hash, i) => {
    const older = count - i - 1
    const roll = next()
    if (older === 0 || roll < 0.03) return { hash, parents: roll < 0.015 ? [] : [`unloaded-${seed}-${i}`] }
    const pick = () => hashes[i + 1 + Math.floor(next() * Math.min(older, 12))]
    const parents = [next() < 0.8 ? hashes[i + 1] : pick()]
    if (next() < 0.2) parents.push(pick())
    if (next() < 0.03) parents.push(pick())
    return { hash, parents: [...new Set(parents)] }
  })
}

describe('extendGraphLayout', () => {
  it.each(Array.from({ length: 40 }, (_, seed) => seed + 1))(
    'matches a full layout when history is appended in pages (seed %i)',
    (seed) => {
      const commits = randomHistory(seed, 60 + seed * 7)
      const next = rng(seed * 31)
      let layout = computeGraphLayout([])
      let loaded = 0
      while (loaded < commits.length) {
        loaded = Math.min(commits.length, loaded + 1 + Math.floor(next() * 40))
        layout = extendGraphLayout(layout, commits.slice(0, loaded))
        expect(layout).toEqual(computeGraphLayout(commits.slice(0, loaded)))
      }
    }
  )

  it('falls back to a full layout when the new list is not an extension', () => {
    const commits = randomHistory(7, 50)
    const first = computeGraphLayout(commits.slice(0, 30))
    // An anchored context load merges rows in the middle.
    const merged = [...commits.slice(0, 10), { hash: 'inserted', parents: [commits[10].hash] }, ...commits.slice(10)]
    expect(extendGraphLayout(first, merged)).toEqual(computeGraphLayout(merged))
  })

  it('leaves the previous layout usable as a base for a different extension', () => {
    const commits = randomHistory(11, 80)
    const base = computeGraphLayout(commits.slice(0, 40))
    extendGraphLayout(base, commits.slice(0, 60))
    expect(extendGraphLayout(base, commits)).toEqual(computeGraphLayout(commits))
    expect(base).toEqual(computeGraphLayout(commits.slice(0, 40)))
  })

  it('falls back for a layout it did not produce', () => {
    const commits = randomHistory(3, 20)
    const foreign = JSON.parse(JSON.stringify(computeGraphLayout(commits.slice(0, 10))))
    expect(extendGraphLayout(foreign, commits)).toEqual(computeGraphLayout(commits))
  })
})
