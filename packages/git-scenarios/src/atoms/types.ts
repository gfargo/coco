import type { TempGitRepo } from '../tempGitRepo'

/**
 * The atom contract: a function from a `TempGitRepo` to a Promise.
 * Every atom in the library produces a `Step` so they can be composed
 * via `chain(...)` or invoked directly in tests.
 *
 *   const step = addCommit({ message: 'init', files: { 'README.md': '# repo' } })
 *   await step(repo)
 *
 * Scenarios' `setup` is also a `Step` — the public type matches so
 * `chain(...)` can be passed directly into the `setup` slot of a
 * scenario definition.
 */
export type Step = (repo: TempGitRepo) => Promise<void>

/**
 * Convenience: a static-content file map. Maps a repo-relative path
 * to the literal string content the atom should write. Use when the
 * file contents are short and human-readable (README, package.json,
 * config files). For procedurally-generated content (deterministic
 * source files for diff fixtures), use `seededFiles` instead.
 */
export type FileMap = Record<string, string>
