<!--
Thanks for contributing to git-coco! Keep PRs small and focused — one logical change.
Title should follow Conventional Commits, e.g. `feat(commit): …` / `fix(ui): …`.
-->

## What

<!-- What does this change do, and why? Link the issue it addresses. -->

Closes #

## How

<!-- Brief notes on the approach, and anything reviewers should look at closely. -->

## Validation

- [ ] `npm test` passes locally (lint + jest + build + packaged-CLI smoke)
- [ ] New behavior has tests; TUI changes carry render coverage (`src/workstation/README.md`)
- [ ] `schema.json` regenerated if config types changed (`npm run build:schema`)
- [ ] Docs updated where relevant (README / `.wiki/`)
- [ ] Commits follow Conventional Commits

## Notes

<!-- Screenshots / GIFs for TUI changes, breaking-change callouts, follow-ups, etc. -->
