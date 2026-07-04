# Contributing to Coco

Thank you for considering contributing to Commit Copilot! We appreciate your interest in helping make this open source project even better. This document outlines the guidelines and processes for contributing to the project, and we encourage you to read it before getting started.

## Table of Contents

- [Contributing to Coco](#contributing-to-coco)
  - [Table of Contents](#table-of-contents)
  - [How Can I Contribute?](#how-can-i-contribute)
  - [Code of Conduct](#code-of-conduct)
  - [Submitting Issues](#submitting-issues)
  - [Submitting Feature Requests](#submitting-feature-requests)
  - [Development Setup](#development-setup)
  - [Submitting Pull Requests](#submitting-pull-requests)
  - [Community](#community)
  - [Acknowledgements](#acknowledgements)

## Quick start

Package manager is **Yarn (v1)**, despite the npm-style script names — see `AGENTS.md`. Install with `yarn install`, not `npm install`: npm won't respect `yarn.lock` or the `resolutions` dependency pins, and CI rejects a committed `package-lock.json`.

```bash
git clone https://github.com/<your-fork>/coco && cd coco
yarn install
npm run dev          # watch mode (use `npm run dev:tui` for coco ui / log -i / workspace)
```

Before opening a PR, run the full validation suite — the same gates CI runs:

```bash
npm test             # lint + jest + build + packaged-CLI smoke
```

See `AGENTS.md` for the full breakdown of environment gotchas (Node version, worktree caveats, CI-parity env vars) behind these commands.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (this project dogfoods `coco commit`). Keep each PR small and focused, and make sure it passes the suite above on its own.

## How Can I Contribute?

There are several ways in which you can contribute to Commit Copilot (coco):

- Report bugs or suggest enhancements by submitting issues.
- Implement new features or fix existing bugs by submitting pull requests.
- Improve documentation by fixing errors, adding examples, or suggesting enhancements.
- Engage with the community by answering questions, reviewing pull requests, or participating in discussions.

## Code of Conduct

We have adopted a [Code of Conduct](CODE_OF_CONDUCT.md) that we expect all contributors to adhere to. Please read the code of conduct carefully to understand the behavior we expect from everyone involved in this project.

## Submitting Issues

If you encounter a bug, have a feature request, or need assistance, please [submit an issue](https://github.com/gfargo/coco/issues) on our GitHub repository. Before creating a new issue, please search the existing issues to see if a similar one already exists. When submitting an issue, provide as much detail as possible, including steps to reproduce the problem or a clear description of the enhancement you would like to see.

## Submitting Feature Requests

If you have an idea for a new feature or an improvement to an existing feature, we would love to hear it! You can [submit a feature request](https://github.com/gfargo/coco/issues/new?template=feature_request.yml) on our GitHub repository. Please provide a clear and concise description of the feature you would like to see and any relevant use cases.

## Development Setup

To set up a development environment for Commit Copilot, follow these steps:

1. Fork the Commit Copilot repository on GitHub.
2. Clone your forked repository to your local machine.
3. Install the required dependencies with `npm install`.
4. Build the project locally with `npm run build` and ensure that tests pass with `npm test`.
5. You are now ready to start making changes!

### Where things live

The codebase is split into four top-level concerns under `src/`:

- `commands/` — CLI subcommands (`commit`, `changelog`, `log`, `ui`, `review`, `recap`, etc.)
- `git/` — Shared git data layer (overview loaders + workstation-shaped action wrappers)
- `workstation/` — The full Ink-based TUI. **Has its own `README.md`** documenting the layout, the input → state → render flow, and how to add a new view.
- `lib/` — Core libraries (config, langchain, simple-git, parsers, ui, utils)

Test scenarios (deterministic temp git repo states) come from the [`@gfargo/git-scenarios`](https://github.com/gfargo/git-scenarios) npm package — coco was the original consumer; the package was extracted from `src/lib/testUtils/` after the abstractions stabilized. Import via `@gfargo/git-scenarios`.

If you're contributing TUI changes, read `src/workstation/README.md` first.

### Testing the workstation (`coco ui`)

Coco ships with a scenario library that spins up deterministic temp git repos for manual + automated testing. List the available scenarios, then create one and run `coco ui` against it:

```bash
npm run scenario list                                              # show all scenarios
npm run scenario describe feature-pr-ready                         # describe one
npm run scenario create feature-pr-ready -- --run-ui               # create + launch coco ui
npm run scenario create dirty-many-files -- --run-ui               # different scenario
```

`--run-ui` spawns `coco ui` against the materialized repo — the tightest dev loop for trying workstation changes against a known state. The scenarios cover the common shapes (feature branch ready to PR, dirty worktree with many files, in-progress bisect, merge conflict, stashed changes, etc.) so you can validate keystroke behaviors and rendering without hand-building repo state every time.

For automated tests, use `spinUpScenario` from `@gfargo/git-scenarios` instead of inline `writeFile` / `commitAll` setup:

```ts
import { spinUpScenario } from '@gfargo/git-scenarios'

const repo = await spinUpScenario('two-commit-feature')
// repo.path / repo.git / repo.writeFile / repo.commitAll / repo.cleanup
```

See the [`@gfargo/git-scenarios`](https://github.com/gfargo/git-scenarios) README for the full list of scenarios, the programmatic API, and the discipline for adding new scenarios.

### Targeting an arbitrary repo without `cd`

Every coco command (including `ui` / `log`) accepts a global `--repo <dir>` flag (alias `--cwd`). Useful when you want to drive coco against a checkout in another directory without changing your shell's working directory:

```bash
# Run the workstation against any project from your current shell
node_modules/.bin/tsx src/index.ts ui --repo ~/work/some-other-project

# Smoke-test commit message generation against an arbitrary repo
node_modules/.bin/tsx src/index.ts commit --repo ~/work/some-other-project --dry-run
```

The handlers chdir to the targeted path up-front so config lookup, simple-git baseDir, commitlint discovery, and downstream path resolution all see the same root. Lives in `src/commands/utils/applyRepoFlag.ts` if you need to wire it into a new command.

## Documentation

The GitHub wiki is the canonical source for user-facing documentation. The local wiki checkout lives at `.wiki/` and can be managed with:

```bash
npm run wiki:pull
npm run wiki:status
npm run wiki:push
```

Keep repository docs concise and link to the wiki for detailed guides. Update `README.md` for high-level feature visibility, update the wiki for full user documentation, and regenerate `schema.json` with `npm run build:schema` when configuration types change.

## Submitting Pull Requests

We welcome and encourage pull requests from the community. To submit a pull request, please follow these steps:

1. Fork the Commit Copilot repository on GitHub.
2. Clone your forked repository to your local machine.
3. Create a new branch from the `main` branch for your changes.
4. Implement your changes and ensure that they follow our coding guidelines.
5. Test your changes thoroughly.
6. Commit your changes and push them to your forked repository.
7. Submit a pull request to the `main` branch of the Commit Copilot repository.

Please provide a clear and detailed description of the changes you have made in your pull request (the PR template will prompt you). We will review your contribution as soon as possible.

**Before you open the PR, confirm:**

- [ ] `npm test` passes locally (lint + jest + build + CLI smoke).
- [ ] New behavior has tests; TUI changes carry render coverage (see `src/workstation/README.md`).
- [ ] `schema.json` is regenerated if config types changed (`npm run build:schema`).
- [ ] Commit messages follow Conventional Commits.
- [ ] The PR is focused on one logical change.

## Community

We encourage community participation and value the input of every contributor.

You can engage with the Commit Copilot community in the following ways:

<!-- - Join our [mailing list](mailto:mailinglist@example.com) to receive important announcements and updates. -->
- Follow us on [Twitter](https://twitter.com/gfargo) for the latest news and project updates.
- Participate in discussions on our [GitHub repository](https://github.com/gfargo/coco/discussions). 


## Acknowledgements

We would like to extend our heartfelt thanks to all the contributors who have helped make Commit Copilot better. Your contributions and feedback are invaluable. We also appreciate the support and encouragement from the broader open source community.

Thank you for your interest in contributing to Commit Copilot! We look forward to your contributions and hope you enjoy your experience working with the project.
