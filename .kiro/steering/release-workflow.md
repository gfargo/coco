---
inclusion: manual
---

# Release Workflow

End-to-end checklist for cutting a new coco release. Covers everything from
reviewing pending PRs through writing release notes and syncing the wiki and
marketing website. Pull this file into context when the user says "prepare the
next release", "write release notes", "update the wiki/www for the release", or
similar.

## 1. Review and merge pending PRs

```bash
gh pr list --state open --limit 30
```

For each open PR:
- Check CI status (`gh pr view <N> --json statusCheckRollup`)
- If all checks pass: merge (`gh pr merge <N> --squash`)
- If duplicate of another PR: close the older one with a comment
- If CI fails on a non-blocking way (e.g. dev-only dep breaking change): skip
  it for this cycle with a note explaining why

After merging, pull main locally:
```bash
git checkout main && git pull --ff-only
yarn install --frozen-lockfile
```

## 2. Run the full local validation gate

```bash
npm run lint                       # 0 errors
TZ=UTC npm run test:jest           # all suites pass
```

If any test fails due to environment drift (e.g. real usage data on the dev
machine, timezone sensitivity), fix and commit the test before proceeding.

## 3. Gather the change set

```bash
# Identify the last release tag
git tag --sort=-v:refname | head -3

# List all commits since that tag
git log <last-tag>..HEAD --oneline --no-merges

# Count
git log <last-tag>..HEAD --oneline --no-merges | wc -l

# Filter by type
git log <last-tag>..HEAD --oneline --no-merges | grep -i "^[a-f0-9]* feat"
git log <last-tag>..HEAD --oneline --no-merges | grep -i "^[a-f0-9]* fix"
git log <last-tag>..HEAD --oneline --no-merges | grep -iE "^[a-f0-9]* (perf|refactor|chore|ci|test|docs)"
```

Group commits thematically (not by PR number). Typical groups:
- New commands / CLI surfaces
- Agent / MCP additions
- Forge / multi-provider expansions
- Workstation / TUI improvements
- Config / provider changes
- Performance
- Fixes (grouped by subsystem)
- Internal / CI
- Dependency bumps (rolled into one line)

## 4. Write the release notes

Load the style guide:
```
#[[file:.kiro/steering/release-notes-style.md]]
```

Load the previous release notes for reference (`specs/RELEASE_NOTES_<prev>.md`).

Write `specs/RELEASE_NOTES_<version>.md` following the style guide. Key rules:
- No em-dashes, no marketing language, no "We're excited..."
- Lead with a framing paragraph connecting to the prior release
- Group by theme under `###` headings, ordered by impact
- Verb-led bullets, specific and technical
- Roll dependency bumps into one closing line
- No hard line wrapping (single long lines per bullet)

## 5. Audit and update the wiki (`.wiki/`)

The wiki is the source of truth for user-facing documentation. The www `/docs`
pages render from it via ISR.

Check each new feature against existing wiki pages:

| New feature | Wiki action needed |
|-------------|-------------------|
| New command | Create a new page (e.g. `Coco-Watch.md`) |
| New CLI flags on existing command | Update `Command-Reference.md` |
| New MCP tool/resource/prompt | Update `Agent-CLI-and-MCP.md` |
| New config field | Update `Config-Overview.md` |
| New forge support | Update `Multi-Forge-Support.md` |
| New TUI feature | Update `Coco-UI.md` or `TUI-Navigation.md` |

Also update `Home.md` to link any new pages and refresh feature descriptions.

Commit and push directly to `master`:
```bash
cd .wiki
git add -A
git commit -m "docs: document <version> (<brief summary>)"
git push origin master
```

## 6. Audit and update the website (`.www/`)

The marketing site highlights features for prospective users. Key files:

| File | What to check |
|------|---------------|
| `src/app/_home/sections/Toolbelt.tsx` | New commands need card entries |
| `src/app/_home/sections/ForgeSupport.tsx` | New forges need entries in the array + subtitle update |
| `src/app/_home/sections/AgentMcp.tsx` | New MCP tools need entries, tool count needs updating |
| `src/app/_home/sections/KeyFeatures.tsx` | Major new capabilities (budget caps, undo stack, etc.) |

After changes, verify the build:
```bash
cd .www
npx tsc --noEmit
npx next build
```

Commit and push to `main`:
```bash
git add <changed files>
git commit -m "feat(home): update for <version>"
git push origin main
```

## 7. Push the main repo changes

If any test fixes or the release notes file were committed locally:
```bash
cd /path/to/coco
git push origin main
```

## 8. Trigger the release

The release is cut manually via `npm run release` (release-it). It:
1. Pulls `--ff-only`
2. Runs lint + full test suite
3. Bumps version, commits, tags, pushes
4. Creates the GitHub release
5. Publishes to npm

The Homebrew tap updates automatically from the GitHub release via
`update-homebrew-tap.yml`.

## Checklist summary

- [ ] Open PRs reviewed and merged (or explicitly skipped)
- [ ] Local tests green on main
- [ ] `specs/RELEASE_NOTES_<version>.md` written
- [ ] Wiki pages created/updated and pushed
- [ ] Website sections updated and pushed
- [ ] Main repo pushed (test fixes, release notes)
- [ ] `npm run release` triggered

## Notes

- The `.wiki/` and `.www/` are separate git repositories (gitignored from the
  main coco repo). They have their own commit histories.
- The wiki uses GitHub Wiki git (push to `master`). The www uses the
  `gfargo/git-co.co` repo (push to `main`).
- Screenshots (`npm run screenshot:sync`) should be regenerated if any TUI
  visual changed, but this is separate from the release-notes workflow and
  typically handled by the visual-regression CI workflow.
