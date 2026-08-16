import { schema } from '../../schema'
import { TRUSTED_PROJECT_TOP_LEVEL_KEYS, UNTRUSTED_PROJECT_TOP_LEVEL_KEYS } from './projectConfig'

/**
 * #1840 happened because `autoFixTool` / `autoFixToolOptions` landed as new
 * top-level `Config` fields and nobody added them to the project-config
 * trust boundary — the blocklist trusted anything it didn't explicitly
 * name. This test is the guardrail: every top-level key in the
 * schema-generated `Config` shape (source of truth for what a `.coco.json`
 * can structurally contain) must be explicitly triaged into either
 * `TRUSTED_PROJECT_TOP_LEVEL_KEYS` or `UNTRUSTED_PROJECT_TOP_LEVEL_KEYS`.
 * A new key that lands without that triage fails this test instead of
 * silently inheriting "trusted" by default.
 *
 * Deliberately does NOT try to cover the wider per-command option surface
 * (`noVerify`, and similar flags `commit`/`amend`/`split`/etc. each define)
 * — those were never part of `Config`/`schema.json` and a real attempt to
 * enumerate them broke `noVerify` (see git history on this file). This
 * test only holds the schema-visible surface — where the actual #1840
 * fields lived — to the "someone remembered to triage it" bar.
 */
describe('project config top-level trust boundary is complete (#1840)', () => {
  const schemaKeys = Object.keys(
    schema.definitions.ConfigWithServiceObject.properties
  ).filter((key) => key !== 'service')

  it('every schema-visible top-level Config key is triaged as trusted or untrusted', () => {
    const trusted = new Set<string>(TRUSTED_PROJECT_TOP_LEVEL_KEYS)
    const untrusted = new Set<string>(UNTRUSTED_PROJECT_TOP_LEVEL_KEYS)

    const untriaged = schemaKeys.filter((key) => !trusted.has(key) && !untrusted.has(key))

    expect(untriaged).toEqual([])
  })

  it('no key is claimed as both trusted and untrusted', () => {
    const overlap = TRUSTED_PROJECT_TOP_LEVEL_KEYS.filter((key) =>
      (UNTRUSTED_PROJECT_TOP_LEVEL_KEYS as readonly string[]).includes(key)
    )

    expect(overlap).toEqual([])
  })

  it('the two lists together do not claim a key the schema no longer has', () => {
    // Catches the inverse drift: a key removed from Config that's still
    // sitting in one of these lists — dead weight, not a security gap, but
    // worth flagging so the lists stay an accurate map of the real surface.
    const schemaKeySet = new Set(schemaKeys)
    const stale = [...TRUSTED_PROJECT_TOP_LEVEL_KEYS, ...UNTRUSTED_PROJECT_TOP_LEVEL_KEYS].filter(
      (key) => !schemaKeySet.has(key)
    )

    expect(stale).toEqual([])
  })
})
