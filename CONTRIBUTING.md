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

If you have an idea for a new feature or an improvement to an existing feature, we would love to hear it! You can [submit a feature request](https://github.com/gfargo/coco/issues/new?assignees=&labels=feature+request&template=feature_request.md) on our GitHub repository. Please provide a clear and concise description of the feature you would like to see and any relevant use cases.

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
- `lib/` — Core libraries (config, langchain, simple-git, parsers, ui, utils, testUtils)

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

For automated tests, use `spinUpScenario` from `src/lib/testUtils/spinUpScenario` instead of inline `writeFile` / `commitAll` setup:

```ts
import { spinUpScenario } from 'src/lib/testUtils/spinUpScenario'

const repo = await spinUpScenario('two-commit-feature')
// repo.path / repo.git / repo.writeFile / repo.commitAll / repo.cleanup
```

See `src/lib/testUtils/README.md` for the full list of scenarios, the programmatic API, and the discipline for adding new scenarios.

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

Please provide a clear and detailed description of the changes you have made in your pull request. We will review your contribution as soon as possible.

## Community

We encourage community participation and value the input of every contributor.

You can engage with the Commit Copilot community in the following ways:

<!-- - Join our [mailing list](mailto:mailinglist@example.com) to receive important announcements and updates. -->
- Follow us on [Twitter](https://twitter.com/gfargo) for the latest news and project updates.
- Participate in discussions on our [GitHub repository](https://github.com/gfargo/coco/discussions). 


## Acknowledgements

We would like to extend our heartfelt thanks to all the contributors who have helped make Commit Copilot better. Your contributions and feedback are invaluable. We also appreciate the support and encouragement from the broader open source community.

Thank you for your interest in contributing to Commit Copilot! We look forward to your contributions and hope you enjoy your experience working with the project.
