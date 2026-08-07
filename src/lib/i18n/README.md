# i18n

Minimal flat message-catalog framework for UI chrome strings. English is
the only locale today — this is the plumbing (catalog type + lookup
helper) that later sub-items build on to migrate the remaining hardcoded
string sites (`surfaceStates`, `inkKeymap`, the help overlay) and,
eventually, add non-English locales.

## Files

- `t.ts` — `Catalog` / `MessageValue` types and the `t(catalog, key, args?)` lookup helper.
- `en.ts` — the English catalog (currently seeded with `aiErrors` messages).

## Pattern for migrating a file

1. Add its strings to `en.ts` under a namespaced key: `<domain>.<subdomain>.<name>`
   (e.g. `ai.error.rateLimit`, `surfaceStates.commit.empty`, `keymap.help.title`).
   Use a plain string for static text, or `(args) => \`...\`` for anything
   that interpolates a value.
2. Replace the inline string literal at the call site with `t(en, 'the.key')`
   (or `t(en, 'the.key', { ...args })` for interpolated entries).
3. Leave genuinely dynamic content (stack traces, user-provided text, output
   derived at runtime from arbitrary input) out of the catalog — only the
   fixed, human-authored copy belongs there.
4. Keep the catalog flat — no nested objects, no ICU/plural rules, no locale
   negotiation. A missing key falls back to returning the key itself, so a
   typo'd or unmigrated lookup is visible rather than silently swallowed.
