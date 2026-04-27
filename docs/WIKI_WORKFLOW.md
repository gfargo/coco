# GitHub Wiki Workflow

The GitHub wiki lives in its own repository at:

```bash
git@github.com:gfargo/coco.wiki.git
```

Keep a local checkout in `.wiki/`. That directory is intentionally ignored by
the main Coco repository so wiki edits do not mix with source changes.

## Documentation Source Of Truth

The GitHub wiki is the canonical home for durable Coco documentation.

Use the main repository for:

- `README.md`: short project overview, install path, and links to the wiki
- `docs/`: temporary planning notes, audits, or migration source material
- `.wiki/`: maintained user-facing docs, contribution docs, and command references

When a file in `docs/` becomes stable enough to guide users or contributors,
migrate it into a relevant wiki section such as Local Development, Contributing,
Command Reference, AI Workflows, Release Process, or Troubleshooting. After the
wiki page exists, either remove the old `docs/` file or replace it with a short
pointer to the wiki page if the in-repo reference is still useful for developers.

## Setup

```bash
npm run wiki:clone
```

This clones the wiki into `.wiki/`.

## Daily Use

```bash
npm run wiki:status
npm run wiki:pull
```

Edit pages inside `.wiki/`, then commit and push from the wiki checkout:

```bash
cd .wiki
git status
git add .
git commit -m "docs: update command reference"
git push
```

You can also push committed wiki changes from the main repo:

```bash
npm run wiki:push
```

## Keeping Docs Aligned

When changing user-facing behavior, check these docs together:

- `README.md`
- `.wiki/`

Good candidates for wiki updates:

- New commands or options
- Config changes
- Release workflow changes
- AI provider/model behavior
- Examples that are too long for the README
- Troubleshooting notes from user reports

Use `docs/` as a staging area only when the content is implementation-adjacent,
not ready for the wiki, or easier to review in the same PR as a code change.

## Suggested Wiki Audit

Before a release, compare the wiki against:

```bash
npm run wiki:pull
npm run wiki:status
```

Then review:

- Command reference pages against current `src/commands/*/config.ts`
- Configuration pages against `schema.json`
- Advanced usage pages against any remaining `docs/` staging files
- Troubleshooting pages against recent issues and release notes
