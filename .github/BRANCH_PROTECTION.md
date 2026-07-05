# Branch Protection

Recommended required checks for `main` (matches the job names in
`.github/workflows/ci.yml` and `.github/workflows/devskim.yml`):

- `Lint`
- `Test (Node 22.22.2 on ubuntu-latest)`
- `Test (Node 24.15.0 on ubuntu-latest)`
- `Test (Node 22.22.2 on macos-latest)`
- `Build & package`
- `Packaged CLI smoke`
- `Integration tests`
- `DevSkim`

The Windows matrix cell (`Test (Node 22.22.2 on windows-latest)`) is marked
`continue-on-error` in `ci.yml` and intentionally excluded from this list;
promote it once it's reliably green.

These checks run linting, the Jest suite across the OS/Node matrix, the
build/schema-generation pipeline (with generated-schema drift detection),
the packaged CLI smoke test, integration tests, and a security scan. They
are intended to catch release-blocking failures before merge.

## Preventing green-alone/broken-together merges

Two independently-green PRs can still combine into a broken `main` (e.g.
each touches something the other's tests don't exercise together). Two
complementary defenses:

1. **Require branches to be up to date before merging** (recommended,
   minimal cost). Under Settings → Branches → branch protection rule for
   `main`, enable this alongside required status checks. It forces a
   rebase + fresh CI run against current `main` before every merge,
   serializing merge trains so combinations are tested before landing.
2. **GitHub merge queue** (fuller fix, more setup). Batches queued PRs and
   tests their combination automatically before merging. Requires
   `allow_auto_merge` to be enabled on the repo first — it's currently
   `false` (checked via `gh api repos/gfargo/coco --jq .allow_auto_merge`).

Both of these are manual actions in GitHub Settings → Branches for a repo
admin (@gfargo) — they can't be applied from a pull request, and this
bot's `gh` token gets a 403 on `GET /repos/gfargo/coco/branches/main/protection`,
confirming it has no access to change them either.

As a backstop that works regardless of whether the above is enabled, the
`Main broken alert` workflow (`.github/workflows/main-broken-alert.yml`)
watches `CI` runs on pushes to `main` and files (or comments on) a `bug`
issue within minutes if one goes red, so a broken `main` is loud
immediately instead of surfacing on the next PR's CI.

Admin bypasses should be reserved for urgent release repair only. When a bypass is
used, run `npm test` locally before pushing and follow up with a normal pull request
for any non-emergency cleanup.
