/**
 * Keymap collision guard.
 *
 * The workstation deliberately overloads single keys across views (see
 * `src/workstation/KEYMAP.md`). Those overloads live in the imperative
 * resolver (`inkInput.ts`) and are disambiguated by dispatch precedence —
 * this test can't see them.
 *
 * What it CAN guard is the declarative binding table (`LOG_INK_KEY_BINDINGS`),
 * the source for the `?` help overlay and the `:` palette. Two bindings that
 * claim the same key in the same context there is almost always an accident:
 * one of them will be unreachable or mislabeled. This test fails the build the
 * moment that happens, so a new binding can't silently shadow an existing one.
 *
 * If a collision is ever intentional (e.g. two ids that the resolver gates on
 * finer state than `contexts` can express), add it to ALLOWED_COLLISIONS with a
 * comment justifying why — that keeps the exception visible and reviewed.
 */
import { LOG_INK_KEY_BINDINGS } from './inkKeymap'

/**
 * Intentional, reviewed `(context::key)` collisions. Keep empty unless a
 * specific overload genuinely needs both ids in the same coarse context; each
 * entry must carry a justification comment.
 */
const ALLOWED_COLLISIONS = new Set<string>([])

describe('LOG_INK_KEY_BINDINGS collision guard', () => {
  it('never binds the same key to two ids in the same context', () => {
    const seen = new Map<string, string[]>()

    for (const binding of LOG_INK_KEY_BINDINGS) {
      for (const context of binding.contexts) {
        for (const key of binding.keys) {
          const slot = `${context}::${key}`
          const ids = seen.get(slot) ?? []
          ids.push(binding.id)
          seen.set(slot, ids)
        }
      }
    }

    const collisions = [...seen.entries()]
      .filter(([slot, ids]) => ids.length > 1 && !ALLOWED_COLLISIONS.has(slot))
      .map(([slot, ids]) => `${slot} → ${ids.join(', ')}`)

    expect(collisions).toEqual([])
  })

  it('every binding declares at least one key and one context', () => {
    // A binding with no key or no context can never fire and can never be
    // discovered — almost certainly a mistake during a refactor.
    const broken = LOG_INK_KEY_BINDINGS.filter(
      (b) => b.keys.length === 0 || b.contexts.length === 0
    ).map((b) => b.id)

    expect(broken).toEqual([])
  })
})
