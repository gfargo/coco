![coco banner image](https://repository-images.githubusercontent.com/663130268/2fc2b7a1-2626-4f9a-9938-a5b410db1b0e)

# `coco`

[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![Typescript Support](https://img.shields.io/npm/types/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![GitHub issues](https://img.shields.io/github/issues/gfargo/coco)](https://github.com/gfargo/coco/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/gfargo/coco)](https://github.com/gfargo/coco/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![Discord](https://img.shields.io/discord/1176716060825767948)](https://discord.gg/KGu9nE9Ejx)

Spawned by the dream to automate away the tedium of writing commit messages, `coco` has grown into a multi-facetted git assistant to expedite any developer git workflow.

Currently `coco` generates commit messages, creates changelogs, summarizes code changes, perform code review, and more - with new features being added regularly!

## Commands

- **`commit`**: generates commit messages based on staged changes.

- **`changelog`**: create changelogs for the current branch or a range of commits.

- **`recap`**: summarize changes from working-tree, or yesterday, or in the last month, or since the last tag.

- **`review`**: perform a code review on the changes in the working directory.

- **`init`**: step by step wizard to set up `coco` globally or for a project.

- **`help`**: display help for `coco` commands.

## Getting Started

**`coco init`** is the first step to getting started with `coco`. It will guide you through the installation process, including setting up your OpenAI API key and configuring `coco` to your preferences.

```bash
# For local project use
npx git-coco@latest init -l project

# For global use
npx git-coco@latest init -l global
```

## Usage

### **`coco commit`**

Generates commit messages based on staged changes with intelligent commitlint integration.

```bash
coco

# or 

coco commit
```

#### Commitlint Integration

`coco` automatically detects and integrates with your project's commitlint configuration:

- **Smart Detection**: Automatically finds commitlint config files (`.commitlintrc.*`, `commitlint.config.*`, or `package.json` with commitlint field)
- **AI-Aware Rules**: Passes your commitlint rules to the AI for better compliance from the start
- **Automatic Retry**: When validation fails, `coco` automatically retries generation with error feedback (up to 2 attempts)
- **User-Friendly Flow**: After auto-retries, offers options to try 2 more times or edit manually
- **Full Validation**: Both AI-generated and manually edited commit messages are validated against your rules

#### Useful options

```bash
# --append
# Add content to the end of the generated commit
coco --append "Resolves #128"

# --append-ticket
# Automatically append Jira/Linear ticket ID from the branch name to the commit message 
coco --append-ticket

# --additional
# Add extra context before generating the commit
coco --additional "Resolves UX bug with sign up button"

# --conventional
# Force conventional commits mode (also enabled automatically with commitlint config)
coco --conventional
```

### **`coco changelog`**

Creates changelogs.

```bash
# For the current branch
coco changelog

# For a specific range (using HEAD references)
coco changelog -r HEAD~5:HEAD

# For a specific range (using commit hashes)
coco changelog -r abc1234:def5678

# For a target branch
coco changelog -b other-branch

# For all commits since the last tag
coco changelog -t
```

### **`coco recap`**

Summarize the working-tree, or other configured ranges

```bash
# Summarize all working directory changes
coco recap

# Or these available ranges
coco recap --yesterday | --last-week | --last-month | --last-tag
```

### Stdout vs. Interactive Mode

`coco` offers two modes of operation: **stdout** and **interactive**, defaulting to **stdout**. You can specify your preferred mode in your config file or via command line flags.

```bash
# Stdout mode
git commit -m $(coco)

# Interactive mode
coco -i
```

### Generate and commit all in one

`coco` can generate and commit your changes in one command.

```bash
coco -s
```

## Configuration

The `.coco.config` documentation has moved to our [wiki](https://github.com/gfargo/coco/wiki/Config-Overview). Here, you'll find detailed information on setting up and customizing your experience.

### **Ignoring Files**

You can specify files to be ignored when generating commit messages by adding them to your config file or via command line flags.  Read more about ignoring files & extensions in the [wiki](https://github.com/gfargo/coco/wiki/Ignoring-Files-&-Extensions).

## Contribution

We welcome contributions! Check out our [CONTRIBUTING.md](CONTRIBUTING.md) for more information.

## Project Stats

![Alt](https://repobeats.axiom.co/api/embed/ea76b881139f16595a343046d4f2bc9125a47e26.svg "Repobeats analytics image")

## License

MIT © [gfargo](https://github.com/gfargo/)

<div style="text-align:center; padding-top: 2rem;">
<img src="https://coco.griffen.codes/mascott/mascott_d.png" width="200px">
<p>Thanks for using <code>coco</code> ✨💜</p>
</div>
