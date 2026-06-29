# Tasks — `www-site-redesign`

Implementation plan. Each task references the requirements it satisfies so a completed
task can be checked against what was asked. Grouped by concern; groups are roughly
ordered but the data-layer groups (6, 7) land early because routes depend on them.

## 1. Foundation & theme

- [x] 1.1 Establish the dark terminal theme tokens (palette, monospace accents) in
  `tailwind.config.ts` — _Requirements: 8.1_
- [x] 1.2 Build the shared terminal-themed header + footer and route shell —
  _Requirements: 2.3, 8.1_
- [x] 1.3 Add a styled, copyable code/command component — _Requirements: 1.2, 8.2_

## 2. Home page & positioning

- [x] 2.1 Decompose the landing page into ordered `_home/sections/` — _Requirements: 2.1_
- [x] 2.2 Build the hero leading with command value, then the workstation payoff —
  _Requirements: 1.1, 1.4_
- [x] 2.3 Add the install affordance with one-line copy — _Requirements: 1.2_
- [x] 2.4 Place the commit-flow motion asset above the fold without blocking paint —
  _Requirements: 1.3, 9.2_

## 3. Navigation

- [x] 3.1 Top-level nav across home, workstation, compare, changelog, docs —
  _Requirements: 2.1_
- [x] 3.2 Collapsible mobile nav with keyboard operability + focus states —
  _Requirements: 2.2, 10.2, 12.1_

## 4. Slug utilities (data layer)

- [x] 4.1 Implement `deriveSlugFromFilename` — _Requirements: 6.2, 6.3_
- [x] 4.2 Example tests for slug derivation — _Requirements: 6.2, 6.3_
- [x] 4.3 `fast-check` Property 1 (valid kebab-case) — _Requirements: 6.2, 6.3_

## 5. Changelog system

- [x] 5.1 Implement `parseVersionFromFilename` — _Requirements: 4.2_
- [x] 5.2 `fast-check` Property 3 (version round-trip) — _Requirements: 4.2_
- [x] 5.3 Build `/changelog` from `RELEASE_NOTES_*.md`, newest-first — _Requirements: 4.1, 4.3_

## 6. Wiki discovery & merge (data layer)

- [x] 6.1 Define the `WikiPage` model + hand-curated manifest — _Requirements: 6.1_
- [x] 6.2 `prebuild.mjs` scan of `.wiki/` → generated `discovered-pages.ts` —
  _Requirements: 6.1_
- [x] 6.3 Implement `mergeManifests` (manual wins, dedupe on `wikiPath`) —
  _Requirements: 6.4, 6.5_
- [x] 6.4 Example tests for merge behavior — _Requirements: 6.4, 6.5_
- [x] 6.5 `fast-check` Property 2 (preserve manual, default discovered) —
  _Requirements: 6.4, 6.5_

## 7. Docs routes

- [x] 7.1 `/docs` index from the merged manifest — _Requirements: 6.1, 6.4, 6.5_
- [x] 7.2 `/docs/[slug]` markdown rendering with site code/heading styling —
  _Requirements: 6.2, 6.6_

## 8. Theme gallery

- [x] 8.1 Derive the theme catalog from `THEME_PRESET_COLORS` — _Requirements: 5.1, 5.3_
- [x] 8.2 `/docs/themes` gallery with synced carousel screenshots — _Requirements: 5.2_
- [x] 8.3 Example tests asserting catalog ↔ preset parity (Property 4) —
  _Requirements: 5.1, 5.3_

## 9. Workstation showcase

- [x] 9.1 `/workstation` page presenting the 16 views from `/public/screenshots` —
  _Requirements: 3.1, 3.3_
- [x] 9.2 Document chord nav, palette, and one-keystroke workflows — _Requirements: 3.2_

## 10. Multi-forge story

- [x] 10.1 `/compare` page covering GitHub, GHE, GitLab, Bitbucket — _Requirements: 7.1_
- [x] 10.2 `/gitlab` forge-specific landing — _Requirements: 7.2_

## 11. Performance, a11y, SEO

- [x] 11.1 Static generation for all routes; optimized image assets (WebP) —
  _Requirements: 9.1, 9.2_
- [x] 11.2 Verify Lighthouse mobile ≥ 90 on `/` — _Requirements: 9.1_
- [x] 11.3 WCAG AA contrast pass on the dark theme — _Requirements: 10.1_
- [x] 11.4 Per-route metadata + Open Graph — _Requirements: 11.1_
- [x] 11.5 Sitemap covering all routes + docs slugs — _Requirements: 11.2_

## 12. Responsiveness

- [x] 12.1 Verify 360px → wide-desktop rendering across routes — _Requirements: 12.1_
- [x] 12.2 Constrain motion/screenshot assets within containers on small viewports —
  _Requirements: 12.2_
