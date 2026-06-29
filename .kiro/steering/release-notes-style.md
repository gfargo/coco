---
inclusion: manual
---

# Release Notes Style

Voice and structure for `coco` release notes. This file is `inclusion: manual` —
it loads only when explicitly pulled into context (e.g. "draft the release notes for
0.74.0 #[[file:.kiro/steering/release-notes-style.md]]"), because most sessions don't
write release notes and the guide would otherwise be noise.

The goal: a developer skimming the notes understands what changed and why it matters,
without marketing gloss. The voice is a competent engineer telling another engineer
what shipped.

## Structure

```
## What's Changed
<1–3 sentence framing paragraph: the theme of this release and how it builds on the last>

## Highlights

### <Thematic group>
- <verb-led bullet>
- <verb-led bullet>

### <Thematic group>
- ...
```

- **Open with a framing paragraph.** State the release's through-line and connect it
  to the prior release ("0.35.0 builds polish and reliability on top of the navigation
  shell that landed in 0.34.0"). One to three sentences. No "We're excited to…".
- **Group by theme, not by PR number.** Bucket changes under `###` headings that name
  a capability ("Discoverable navigation", "Richer signal at a glance", "Live,
  responsive UI"). A reader should be able to scan headings and know the shape of the
  release.
- **Order groups by impact.** Lead with the headline change; trailing groups cover
  smaller fixes and internals.

## Bullets

- **Lead with a verb or the concrete subject.** "Pressing `g` now opens a which-key
  chord overlay…", "The history graph renders with colored row spans…", "Truecolor
  rendering with graceful 256-color and ANSI-16 fallbacks."
- **Be specific and technical.** Name the keys, the files, the flags, the terminals.
  "OSC 8 terminal hyperlinks make commit hashes, PR refs, and remote URLs clickable in
  capable terminals (iTerm2, kitty, Wezterm, Terminal.app)" — not "improved terminal
  support."
- **One change per bullet.** If a bullet has an "and" joining two unrelated changes,
  split it.
- **State the user-visible effect**, not the implementation, unless the implementation
  *is* the point (perf, internals). "long AI generations stop feeling frozen" tells the
  reader why the loading indicator matters.

## Hard rules

- **No em-dashes (—).** Use a comma, a period, a colon, or parentheses. This is a
  consistent house style; em-dashes read as AI-generated.
- **No marketing language.** Ban "seamless", "effortless", "powerful", "blazing-fast",
  "game-changing", "revolutionary", "delight", "unlock", "supercharge". If a phrase
  could appear on a SaaS landing page, cut it.
- **No hype framing.** Don't open bullets with "We've added", "Now you can", "Introducing".
  Start with the thing itself.
- **Don't paste commit messages or PR titles verbatim.** Notes are written for readers,
  not generated from `git log`. (`auto-changelog` produces the raw PR list in
  `CHANGELOG.md` — that's separate from these curated notes.)
- **Don't list every dependency bump.** Roll routine `chore(deps)` bumps into a single
  closing line ("Routine dependency and toolchain bumps") if mentioned at all.
- **Keep tense present.** "renders", "watches", "surfaces" — describe what the software
  does now, not what was done to it.

## Anti-patterns → fixes

| Avoid                                                  | Prefer                                                                 |
|--------------------------------------------------------|------------------------------------------------------------------------|
| "We're thrilled to introduce a powerful new theme system!" | "128 theme presets ship behind `--theme` and the in-app picker (`gC`)." |
| "Seamlessly merge PRs from the workstation."           | "Merge the current branch's PR/MR with one keystroke from `coco ui`."  |
| "Various bug fixes and improvements."                  | Name the fixes, grouped under a "Fixes" heading.                       |
| "feat(forge): Bitbucket REST API runner (#1315)"       | "Bitbucket Cloud joins GitHub, GHE, and GitLab across `prs`, `issues`, and the workstation." |

## Reference

The 0.35.0 notes are the canonical example of this voice. Match its density, grouping,
and specificity. The raw per-PR changelog lives in `CHANGELOG.md` (generated); the
curated notes are written by hand from it.
