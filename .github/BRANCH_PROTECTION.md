# Branch Protection

Recommended required checks for `main`:

- `Release gate (Node 22.12.0)`
- `Release gate (Node 24.x)`
- `DevSkim`

The release gate runs linting, Jest, build/schema generation, generated-schema drift
checks, package-manager hygiene checks, and an npm publish dry run. These checks are
intended to catch release-blocking failures before merge.

Admin bypasses should be reserved for urgent release repair only. When a bypass is
used, run `npm test` locally before pushing and follow up with a normal pull request
for any non-emergency cleanup.
