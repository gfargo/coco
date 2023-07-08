# `coco` 🤖 🦍

[![GitHub issues](https://img.shields.io/github/issues/gfargo/coco)](https://github.com/gfargo/coco/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/gfargo/coco)](https://github.com/gfargo/coco/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/gfargo/coco)](https://github.com/gfargo/coco/tree/main)
[![NPM Version](https://img.shields.io/npm/v/git-coco.svg)](https://www.npmjs.com/package/git-coco)
[![NPM Downloads](https://img.shields.io/npm/dt/git-coco.svg)](https://www.npmjs.com/package/git-coco)

Commit Copilot, or `coco`, is your personal scribe for git commit messages. Using [LangChain🦜🔗](https://js.langchain.com/) to automate the task of creating meaningful commit messages based on your staged changes!

## Installation

Get started by adding `coco` to your project's development dependencies:

```bash
npm i git-coco --save-dev
```

Or, for global access, you can install `coco` system-wide:

```bash
npm i -g git-coco
```

## Usage

There are two main ways to use `coco`: 

1. [Interactive Mode](#interactive)
2. [Command Line Interface (CLI)](#cli)

### **Interactive Mode**

Just type `coco` and let the friendly prompts guide you through the commit process!

```bash
coco -i
```

The interactive mode offers you several benefits:

- Preview and approve or regenerate the commit message before it's committed
- Customize your prompts for a personalized commit experience

### **Command Line Interface (CLI)**

If you're the type who likes to keep it simple, you can pass your commit message directly as a CLI argument:

```bash
coco --openAIApiKey="sk_your-openai-api-key"
```

Assuming you've stored your API key in the config file ([learn more](#the-cococonfig)), you can also commit with:

```bash
git commit -m $(coco)
```

Alternatively, take advantage of `coco`'s full potential by allowing it to make the commit for you!

```bash
coco -s
```

## **The `coco.config`**

`coco.config` houses the project-level settings and can be defined in multiple places, adhering to a hierarchical order of priority. If the same configuration is found in multiple places, the higher priority one will be considered.

From highest to lowest, the priority order is:

1. **Command Line Flags**: Flags in the command line have the highest priority, and they override all other settings.
2. **Environment Variables**: Next in line are environment variables. You can set any configuration option as an environment variable.
3. **Project Config (`.coco.config.json`)**: Create a `.coco.config.json` file in your project root to set configurations. It's recommended to store your OpenAI API key here alongside any other project-specific configurations.
4. **Git Profile (`.gitconfig`)**: You can define `coco` settings under a `[coco]` section in your git profile. These settings will be used unless overridden by higher-priority ones.
5. **XDG Configuration Directory**: If `XDG_CONFIG_HOME` is set, `coco` will look for a `coco/config` file in this directory for configurations.

Here's an example `.coco.config.json` file:

```json
{
    "openAIApiKey": "sk_your-openai-api-key",
}
```

And the same settings in `.gitconfig`:

```ini
[coco]
    openAIApiKey = sk_your-openai-api-key
```

Remember, command line flags and environment variables should be defined in `UPPER_SNAKE_CASE`. For instance, the `openAIApiKey` setting becomes `OPENAI_API_KEY`.

### Options

| Name                     | Type                            | Default Value                             | Description                                                                                                               |
|--------------------------|---------------------------------|-------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| openAIApiKey             | string                          | None                                      | Your OpenAI API key                                                                                                       |
| tokenLimit               | number                          | 500                                       | Maximum number of tokens for the commit message                                                                           |
| prompt                   | string                          | `"What are the changes in this commit?"`  | Prompt for OpenAI GPT-3                                                                                                   |
| temperature              | number                          | 0.4                                       | Controls randomness in GPT-3 output. Lower values yield focused output; higher values offer diversity                      |
| mode                     | `stdout` \| `interactive`       | `stdout`                                  | Preferred output method for generated commit messages                                                                     |
| summarizePrompt          | string                          | `"Summarize the changes in this large file:"` | GPT-3 prompt for summarizing large files                                                                                  |
| ignoredFiles             | string[]                        | `["package-lock.json"]`                  | Paths of files to be excluded when generating commit messages                                                             |
| ignoredExtensions        | string[]                        | `[".map", ".lock"]`                      | File extensions to be excluded when generating commit messages                                                            |

## Roadmap

- [x] Interactive mode 🤖
- [x] Stdout 📤
- [x] LangChain integration 🦜
- [ ] Additional tests! 🧪
- [ ] Conventional commits 🔜
- [ ] HuggingFace integration 🔜
- [ ] Google Vertex AI integration (?)
- [ ] Automatic changelog generation 🫣
- [ ] Rebase support 🔀
- [ ] `coco --amend b31dfc` 👩‍💻

...and more! 🧑‍🔬 🚀

## Contribution

Have an idea for a feature or want to get involved, we welcome contributions!

Please check out our [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
