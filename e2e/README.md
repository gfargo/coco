# PTY end-to-end journeys

Keystroke-level tests for the workstation TUI (#1424). Each journey
boots the **real built binary** (`dist/index.js`) inside a
pseudo-terminal (`node-pty`) against a scripted fixture repo
(`@gfargo/git-scenarios`), sends raw keystrokes, and asserts on the
rendered screen text (emulated by `@xterm/headless`).

The ~4,100 unit tests cover the input dispatcher, reducers, hooks, and
renderers in isolation; these journeys cover the seams between them —
raw bytes → raw-mode stdin → g-chord dispatch → view push/pop → Ink
paint — where most of the July 2026 audit's dispatch bugs lived.

## Running

```sh
npm run build      # the harness drives dist/index.js
npm run test:e2e
```

Runs in CI as the `PTY e2e journeys` job (after `build`). Not part of
`test:jest` — the suites live outside the unit-test roots and use
`jest.e2e.config.ts`.

## Writing a journey

```ts
const repo = await createScenarioRepo('stashed-changes') // fixtures.ts
const tui = await launchTui({ cwd: repo.path })          // ptyHarness.ts
await tui.waitForReady('Commits *')  // ALWAYS gate before first keypress
tui.press('g', 'z')                  // named keys or single chars
await tui.waitForText('3/3 stashes') // poll the emulated screen
await tui.close()                    // q → SIGTERM → SIGKILL escalation
await repo.cleanup()
```

Hard-won rules encoded in the harness — keep them in mind when
extending it:

- **Gate on `waitForReady` before the first keypress.** Keystrokes sent
  during the boot stages (cache paint → Ink mount → background refresh)
  are dropped by the not-yet-mounted dispatcher.
- **Anchor waits on content, not panel titles.** Panels render their
  title while their body is still loading (`· loading …` header chips).
- **`CI` must stay `'0'` in the child env.** Ink detects CI and skips
  live rendering entirely, emitting one frame at exit — GitHub Actions
  sets `CI=true`, so the harness forces it off.
- **Determinism** mirrors `bin/screenshot/tape.ts`: `COCO_SNAPSHOT_NOW`
  freezes the render clock (stable relative ages, no spinner),
  `NO_COLOR=1` strips styling, and a throwaway `HOME` isolates the
  user's `~/.coco` config, global gitconfig, and the once-per-machine
  onboarding marker (pre-seeded so journeys don't start on the welcome
  overlay).

The same deterministic scripts are the seed for the VHS visual-
regression / demo-gif half of #1424 — a journey that passes here can be
transcribed into a `.tape` recipe in `bin/screenshot/`.
