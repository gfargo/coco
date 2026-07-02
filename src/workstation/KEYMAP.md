# Workstation Keymap — the deliberate map

The workstation is keyboard-only and key-dense (lazygit-style): single letters
do a lot, and the *same* letter often means different things in different
views. That density is intentional, but it only stays safe if the overloads are
**deliberate** — every reused key disambiguated by a known rule, never by
accident.

This document is the canonical map. It exists to answer three questions:

1. **What does key X do here?** → the per-view tables.
2. **Is key X free to use for a new action in view Y?** → the overload table +
   the dispatch model.
3. **Why didn't my new binding fire?** → the dispatch precedence rules.

It is paired with a regression guard: `inkKeymap.collisions.test.ts` fails the
build if two declarative bindings (`LOG_INK_KEY_BINDINGS`) ever claim the same
key in the same context. The guard can't see the imperative overloads in
`inkInput.ts` — those are what this doc is for.

> Source of truth is the code. `inkInput.ts` is the resolver (what each key
> *does*); `inkKeymap.ts` holds the declarative binding table, footer hints,
> and help sections. When you change a binding, update this map in the same PR.

---

## The dispatch model (read this first)

`resolveLogInkInput` (in `inkInput.ts`) is a single ordered function. A keypress
walks the branches **top to bottom** and the *first* match wins. The order
encodes precedence:

```
1.  Overlays & modes        Help open? input-prompt open? filter mode?  ← claim the key first
2.  Global chords           `g`-prefix pending → chord continuation
3.  Global single keys      q, ?, /, :, <, Ctrl+C, Tab, arrows, page keys
4.  Exact-context handlers   activeView + diffSource + focus all checked
                             e.g. (diff && diffSource==='stash' && selectedFile)
5.  Predicate handlers       isBranchActionTarget(), isCompareFlowTarget(), …
                             (view OR sidebar-tab equivalence)
6.  Fallback workflow lookup getLogInkWorkflowActionByKey() — the LAST resort
```

Two consequences worth internalizing:

- **Context-specific always beats global.** A view that intercepts `D`
  (worktrees) or `C` (conflicts) returns before the fallback workflow
  dispatcher can fire. That's how the same key safely means different things.
- **Negation guards are fragile.** Some globals are gated as
  `activeView !== 'conflicts'`. Adding a new view that wants that key means
  finding and updating the negation. Prefer an explicit allowlist of views when
  you add a new global. (See *Risks* below.)

---

## Modes (input gating)

The header's `[MODE]` chip tells the user which keystroke contract is live:

| Mode | Entered by | What changes |
|------|------------|--------------|
| `NORMAL` | default | Single-key bindings active. |
| `EDIT` | `e` (inline commit-message edit) | Typing edits the buffer; most bindings suppressed. |
| `FILTER` | `/` | Typing builds the filter; `Enter` applies, `Esc` cancels. |

Input prompts (branch name, merge strategy, pathspec, PR comment, …) and the
split-plan overlay also claim the keyboard while open — their footer hint sets
replace the view's, because the underlying bindings are intercepted.

---

## Global keys

Available in every view (unless an overlay/mode has claimed the keyboard):

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Quit (hard) |
| `?` | Toggle help overlay (full categorized help) |
| `:` | Command palette |
| `/` | Enter filter mode |
| `g` | Chord prefix (see below) |
| `<` | Pop view / go back |
| `Esc` | Pop view; pop nested-repo frame; close overlay |
| `Tab` / `Shift+Tab` | Focus next / previous pane |
| `v` | Peek the sidebar (narrow / single-pane terminals only) — momentary glance, `v`/`Esc` snaps back to where you were |
| `↑`/`k`, `↓`/`j` | Move selection / scroll |
| `←`/`→` | Switch sidebar or inspector tab (focus-dependent) |
| `PageUp` / `PageDown` | Page scroll |
| `n` / `N` | Next / previous search match |
| `y` / `Y` | Yank identifier (long / short) for the cursored item |

> `<` and `Esc` both walk back, but `Esc` also pops the **repo** stack — that's
> why the repo breadcrumb shows `← esc` while the view breadcrumb is pure
> location. The footer's global `< back` covers the common case.

---

## `g`-chord continuations (view selectors)

`g` then a second key jumps to a view. This is the primary navigation surface;
the which-key overlay lists them live when you press `g`.

| Chord | Jumps to |
|-------|----------|
| `g h` | History |
| `g s` | Status (staging) |
| `g d` | Diff (worktree) |
| `g c` | Compose (commit message) |
| `g b` | Branches |
| `g t` | Tags |
| `g z` | Stashes (the view) |
| `g Z` | **Stash all changes** (action, not nav) — opens the message prompt; works from *any* view incl. status/diff/compose. Empty message = quick WIP stash. |
| `g w` | Worktrees |
| `g p` | Pull request |
| `g P` | PR triage |
| `g i` | Issues |
| `g x` | Conflicts |
| `g r` | Reflog |
| `g B` | Bisect |
| `g n` | Remotes |
| `g M` | Submodules |
| `g T` | **Create tag** at the cursored commit (history view; name prompt) — *not* changelog; the changelog opens with `L` from history/branches |
| `g H` | Apply cursored hunk to index (`git apply --cached`) |
| `g C` | Theme picker (overlay) |
| `g k` / `g K` | Open the project / global coco config in `$EDITOR` |
| `g ?` | **Which-key strip** (overlay, not nav) — surfaces the *single-key* actions available in the current view (the deliberate overloads below), sourced live from `LOG_INK_KEY_BINDINGS`. `?` from the strip expands to the full help; `Esc` closes. The per-view counterpart to this very `g`-chord menu. |

---

## Per-view keys

Only the view-local keys are listed; global keys and `g`-chords apply
everywhere. "↑/↓ select" is implied in every list view.

### History / log

| Key | Action |
|-----|--------|
| `Enter` | Open diff for the selected commit |
| `d` | Toggle unified / split diff |
| `\` | Toggle the graph column |
| `c` | Cherry-pick the commit |
| `R` | Revert the commit |
| `Z` | Reset branch tip here (mode prompt) |
| `i` | Interactive rebase from the commit's parent |
| `B` | Create branch here |
| `L` | Open the changelog view |
| `r` | Refresh |

### Status (staging)

| Key | Action |
|-----|--------|
| `Enter` | Open the file's hunk diff |
| `Space` | Stage / unstage the cursored file |
| `A` | Stage everything (`git add -A`) |
| `+` | Stage by pathspec (prompt) |
| `z` | Revert the file (confirm) |
| `i` | Open the `.gitignore` picker |
| `o` | Open the file in `$EDITOR` |
| `1`/`2`/`3` | Toggle staged / unstaged / untracked visibility |
| `b` | Blame the cursored file |
| `L` | File history for the cursored file |
| `e` / `c` | Compose: inline edit / commit |

### Diff — worktree (staging diff)

The hunk is the unit of action here.

| Key | Action |
|-----|--------|
| `↑`/`↓` (`j`/`k`) | Line-scroll the diff (the current hunk follows the scroll position) |
| `[` / `]` | Previous / next hunk |
| `Space` | Stage / unstage the selected hunk (whole file if untracked) |
| `a` | Stage / unstage the whole file |
| `z` | Discard the hunk (confirm) |
| `o` | Open the file in `$EDITOR` |

### Diff — commit (read-only exploration)

| Key | Action |
|-----|--------|
| `j`/`k` | Line-scroll the diff body |
| `[` / `]` | Previous / next hunk |
| `c` | Cherry-pick the cursored file into the worktree |
| `H` | Apply the cursored hunk to the worktree |
| `d` | Toggle unified / split |

### Diff — stash (read-only)

| Key | Action |
|-----|--------|
| `j`/`k` | Line-scroll the diff body |
| `[` / `]` | Previous / next **file** (stash diffs index by file) |
| `c` | Restore the cursored file from the stash |
| `H` | Apply the cursored hunk to the worktree |
| `o` | Open the file in `$EDITOR` |
| `d` | Toggle unified / split |

### Diff — compare (two refs)

| Key | Action |
|-----|--------|
| `j`/`k` | Line-scroll |
| `d` | Toggle unified / split |

### Compose (commit message)

| Key | Action |
|-----|--------|
| `e` | Inline edit the message |
| `E` | Edit in `$EDITOR` |
| `c` | Commit |
| `I` | AI-draft the message |
| `S` | Start the commit-split flow |
| `A` | Stage everything |
| `+` | Stage by pathspec |

### Branches

| Key | Action |
|-----|--------|
| `Enter` | Check out |
| `+` | Create branch (prompt) |
| `R` | Rename (prompt) |
| `D` | Delete (confirm) |
| `u` | Set upstream (prompt) |
| `F` / `U` / `P` | Fetch / pull / push the branch |
| `r` | Rebase the current branch onto the cursored branch (confirm) |
| `s` | Cycle the branch sort mode |
| `m` | Mark / unmark compare base |

### Tags

| Key | Action |
|-----|--------|
| `+` | Create tag (prompt) |
| `P` | Push tag to origin |
| `T` / `R` | Delete tag (remote) |
| `m` | Mark / unmark compare base |

### Stashes

| Key | Action |
|-----|--------|
| `Enter` | Open the stash diff |
| `a` | Apply (keep) |
| `A` | Apply restoring the staged/unstaged split (`git stash apply --index`) |
| `p` | Pop (apply + drop) |
| `R` | Rename the stash (re-store under a new message, drop the old) |
| `b` | Create a branch from the stash (`git stash branch`) |
| `X` | Drop (confirm) |
| `u` | Undo the last drop (re-store by commit hash) |
| `y` | Yank the stash ref |

Create a stash with `gZ` (any view) or `S` (outside the staging triad). The
`:` palette also carries **stash staged only** and **stash keeping index**
variants.

### Conflicts

| Key | Action |
|-----|--------|
| `Enter` | Open the conflicted file's diff |
| `s` | Stage (mark resolved) |
| `u` / `U` | Keep incoming changes / keep your branch's version (mapped to git's `--theirs`/`--ours` per operation — a rebase swaps git's sides, the keys don't) |
| `o` | Open in `$EDITOR` |
| `C` | Continue the in-progress operation (only when no conflicts remain) |

### Pull request / PR triage

| Key | Action |
|-----|--------|
| `m` | Merge (strategy prompt) |
| `a` | Approve (confirm) |
| `R` | Request changes (review prompt) |
| `c` | Comment (prompt) |
| `x` | Close (confirm) |
| `O` | Open in browser (triage) |
| `L` / `A` | Label / assign (triage, prompt) |
| `f` | Cycle the PR filter (triage) |

### Issues

| Key | Action |
|-----|--------|
| `O` | Open in browser |
| `c` | Comment (prompt) |
| `L` / `A` | Label / assign (prompt) |
| `x` / `X` | Close / reopen (confirm) |
| `f` | Cycle the issue filter |

### Bisect

| Key | Action |
|-----|--------|
| `g=` | Mark good |
| `b` | Mark bad |
| `s` | Skip / start wizard |
| `x` | Reset bisect |
| `R` | Run custom command |

### Worktrees

| Key | Action |
|-----|--------|
| `D` | Remove worktree **and** delete its branch (intercepts the global branch-delete) |
| `W` | Remove worktree only |

---

## The overload table

These keys mean different things in different views. **Before binding one of
these in a new view, confirm your view's meaning doesn't surprise a user
arriving from another view.** Disambiguation is by the dispatch model above.

| Key | Meanings by context |
|-----|---------------------|
| `c` | history → cherry-pick commit · commit/stash diff → cherry-pick/restore file · status/diff/compose → commit · PR/PR-triage → comment · issues → comment |
| `C` | conflicts → continue operation · compose → *blocked* (guard against fat-finger PR-create) · elsewhere → create PR |
| `R` | history → revert · branches → rename · tags → delete-remote · PR/PR-triage → request changes · bisect → run command |
| `a` | status/worktree-diff → stage whole file · stashes → apply · PR/PR-triage → approve |
| `m` | branches/tags/history (compare flow) → mark compare base · PR/PR-triage → merge |
| `i` | status → open `.gitignore` picker · history → interactive rebase |
| `S` | status/diff/compose → commit-split flow · elsewhere → create stash (the view-agnostic create path is `gZ`, which also works in the staging triad) |
| `P` | branches → push branch · tags → push tag (takes precedence over the global push) |
| `D` | worktrees → remove worktree + branch · branches → delete branch |
| `x` / `X` | PR → close · issues → close / reopen · stashes → drop (`X`) |
| `L` | history/branches → generate changelog · PR-triage/issues → add label |
| `f` | PR-triage → cycle PR filter · issues → cycle issue filter |
| `o` | status/diff/conflicts → open file in `$EDITOR` (consistent — different file resolution only) |
| `[` / `]` | worktree diff → hunk · commit diff → hunk · stash diff → **file** · sidebar/inspector focus → cycle tab |

The three highest-risk overloads, because they're guard-heavy or
context-subtle, are `c`, `C`, and `[`/`]`. Touch their handlers carefully.

---

## Rules for adding or changing a binding

1. **Check this map and the overload table first.** If the key is already
   overloaded, make sure your new meaning is unsurprising for the view and that
   the dispatch order puts your handler before any global that would shadow it.
2. **Add the handler in the correct precedence slot** of `inkInput.ts` — an
   exact-context check (`activeView`/`diffSource`/`focus`) or a predicate, never
   relying on the fallback dispatcher for a view-specific action.
3. **Register the declarative binding** in `LOG_INK_KEY_BINDINGS`
   (`inkKeymap.ts`) with its `keys` + `contexts` so it shows up in `?` help and
   the `:` palette. The collision guard will fail the build if your
   `(key, context)` pair is already taken — that's the safety net.
4. **Keep the footer honest.** If you add the key to a view's footer hint, the
   label must name what the handler actually does. A footer that names a key
   doing something else is a bug (this exact class of bug was an audit finding).
5. **Update this map** in the same PR.
6. **Prefer allowlists over negation guards** for new globals (`activeView in
   [...]` rather than `activeView !== 'x'`), so the next new view doesn't
   silently inherit your key.

---

## Known risks (carried from the TUI audit)

- **Negation-guarded globals** (`C` create-PR gated by `!== 'conflicts'`,
  `S` create-stash gated away from the status/diff/compose triad). Each new view
  must be checked against these.
- **`[` / `]` is the most overloaded navigation key** — hunk vs. file vs. tab,
  decided by `activeView` + `diffSource` + `focus`. A wrong/stale focus value
  sends the keypress to the wrong axis.
- **The declarative table can't model fine-grained gating** (selected-item
  presence, count > 0). The collision guard covers the coarse `(key, context)`
  case only; the imperative overloads above are your responsibility to keep
  deliberate.
