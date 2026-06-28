![coco banner image](https://repository-images.githubusercontent.com/663130268/2fc2b7a1-2626-4f9a-9938-a5b410db1b0e)

# `coco`

[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![Discord](https://img.shields.io/discord/1176716060825767948)](https://discord.gg/KGu9nE9Ejx)

**AI commits, changelogs, code review, PR creation, and a full keyboard-driven git workstation — all from one CLI.** `coco commit` turns your staged diff into a Conventional-Commits-ready message. `coco commit --split` breaks a large staging area into logical multi-commit groups. `coco changelog` writes your release notes. `coco review` catches issues before they ship. `coco pr create` generates a title and body and opens it on your forge. And `coco ui` ties it all together in a terminal workstation with 16 views, chord navigation, and one-keystroke workflows. Seven AI providers — including fully local Ollama — on GitHub, GitHub Enterprise, GitLab, and Bitbucket.

> The package is **git-coco**; the command is `coco`.

```bash
git add .
coco commit          # AI writes the message from your staged changes
```

![coco commit generating a commit message from staged changes](https://coco.griffen.codes/screenshots/readme-commit.gif)

That's the core. Everything else — changelogs, code review, PRs, and the workstation — is the same engine pointed at more of your git workflow.

![coco ui — a full terminal git workstation](https://coco.griffen.codes/screenshots/readme-workstation.gif)

## Why coco

- 🤖 **Smart commits** — contextual AI messages from your staged diff, with Conventional Commits and commitlint validation built in
- 🏠 **Local-first** — run fully offline with Ollama (no API costs, nothing leaves your machine)
- 🖥️ **Terminal workstation** — 16 views (history, status, diff, branches, PRs, issues, and more) via `g`-chord navigation + command palette
- 🌐 **Multi-forge** — GitHub, GitHub Enterprise, GitLab, and Bitbucket from the same tool
- 🎨 **120+ themes** — Catppuccin, Gruvbox, Dracula, Tokyo Night, and many more, with a live picker (`gC`)
- 🩺 **Self-diagnosing** — `coco doctor` audits your config, providers, and model routing in one command

## Install

```bash
# Homebrew (macOS/Linux)
brew install gfargo/tap/coco

# curl
curl -fsSL https://coco.griffen.codes/install.sh | sh

# npm (needs Node 22+)
npm install -g git-coco

# try without installing
npx git-coco@latest init
```

## Quick Start

```bash
coco init            # pick a provider, set preferences
git add .
coco commit -i       # generate your first commit (interactive)
```

## Commands

| Command | What it does |
|---------|-------------|
| [`coco commit`](https://github.com/gfargo/coco/wiki/Command-Reference#commit) | Generate commit messages from staged changes |
| [`coco commit --split`](https://github.com/gfargo/coco/wiki/Command-Reference#commit---split) | Break a large diff into logical multi-commit groups |
| [`coco amend`](https://github.com/gfargo/coco/wiki/Command-Reference#amend) | Regenerate and rewrite the last commit message |
| [`coco changelog`](https://github.com/gfargo/coco/wiki/Command-Reference#changelog) | Create changelogs from commit history (by branch, tag, or range) |
| [`coco pr create`](https://github.com/gfargo/coco/wiki/Command-Reference#pr-create) | Generate PR title + body and open via `gh` / `glab` / Bitbucket API |
| [`coco recap`](https://github.com/gfargo/coco/wiki/Command-Reference#recap) | Summarize recent changes for standups or handoffs |
| [`coco review`](https://github.com/gfargo/coco/wiki/Command-Reference#review) | AI code review with severity gating for CI (`--severity`) |
| [`coco ui`](https://github.com/gfargo/coco/wiki/Coco-UI) | Full-screen git workstation — 16 views, keyboard-driven |
| [`coco workspace`](https://github.com/gfargo/coco/wiki/Command-Reference#workspace) | Multi-repo overview; drill into any repo as a `coco ui` session |
| [`coco log`](https://github.com/gfargo/coco/wiki/Command-Reference#log) | Commit history with graph, filters, and JSON output |
| [`coco prs` / `coco issues`](https://github.com/gfargo/coco/wiki/Command-Reference#prs--issues) | List PRs or issues across GitHub, GitLab, or Bitbucket |
| [`coco doctor`](https://github.com/gfargo/coco/wiki/Command-Reference#doctor) | Diagnose config, providers, model routing, and usage stats |
| [`coco init`](https://github.com/gfargo/coco/wiki/Getting-Started) | Interactive setup wizard |

Global flags: `--repo <dir>` targets any repo without `cd`, `--json` for machine output, `--quiet` suppresses chrome.

## Configuration

```bash
coco init                    # interactive setup
coco init --scope project    # project-specific config
```

Seven providers out of the box — **OpenAI**, **Anthropic**, **Google Gemini**, **Mistral**, **Azure OpenAI**, **AWS Bedrock**, **Ollama** — plus any OpenAI-compatible endpoint. Keys read from config or environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.).

```json
{
  "service": { "provider": "openai", "model": "gpt-4o" },
  "conventionalCommits": true
}
```

See the [Configuration Overview](https://github.com/gfargo/coco/wiki/Config-Overview) for every option — themes, per-task model routing, output modes, and more.

## Documentation

📚 **[Wiki](https://github.com/gfargo/coco/wiki)** — Getting Started, Command Reference, Configuration, Coco UI, Using Ollama, Team Collaboration, Troubleshooting

💬 **[Discord](https://discord.gg/KGu9nE9Ejx)** — real-time help and discussion

🐛 **[Issues](https://github.com/gfargo/coco/issues)** — bug reports and feature requests

## Contributing

We welcome contributions — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Project Stats

![Repobeats](https://repobeats.axiom.co/api/embed/ea76b881139f16595a343046d4f2bc9125a47e26.svg "Repobeats analytics image")

## License

MIT © [gfargo](https://github.com/gfargo/)

<div align="center">
<img src="https://coco.griffen.codes/mascott/mascott_d.png" width="200px">
<p>Thanks for using <code>coco</code> ✨💜</p>
</div>
