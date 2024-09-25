
# Configuration Directory

This directory contains configuration files and services for the application. The configurations are used to manage various settings and behaviors of the application.

## Files and Directories

- `constants.ts`: Defines constants and default configuration settings.
- `types.ts`: Defines TypeScript types for the configuration.
- `services/`: Contains services for loading and managing configurations.
- `utils/`: Contains utility functions for configuration management.

## Configuration Services

### `env.ts`
- **Purpose**: Manages environment variable configurations.
- **Functions**:
  - `loadEnvConfig`: Loads environment variables into the configuration object.
  - `appendToEnvFile`: Appends configuration values to an environment file.

### `git.ts`
- **Purpose**: Manages Git-related configurations.
- **Functions**:
  - `loadGitConfig`: Loads Git profile configuration from `~/.gitconfig`.
  - `appendToGitConfig`: Appends configuration values to a Git config file.

### `ignore.ts`
- **Purpose**: Manages ignored files configurations.
- **Functions**:
  - `loadGitignore`: Loads ignored files from the `.gitignore` file.
  - `loadIgnore`: Loads ignored files from the `.ignore` file.

### `project.ts`
- **Purpose**: Manages project-specific configurations.
- **Functions**:
  - `loadProjectJsonConfig`: Loads project configuration from `.coco.config.json`.
  - `appendToProjectJsonConfig`: Appends configuration values to a project JSON config file.

### `xdg.ts`
- **Purpose**: Manages configurations based on the XDG Base Directory Specification.
- **Functions**:
  - `loadXDGConfig`: Loads configuration from the XDG config directory.

## Usage

### Setting Up a Configuration

1. **Environment Variables**:
   - Define environment variables in your environment or in an `.env` file.
   - Use the `loadEnvConfig` function to load these variables into the configuration object.

2. **Git Configuration**:
   - Define configuration settings in the `[coco]` section of your `~/.gitconfig` file.
   - Use the `loadGitConfig` function to load these settings into the configuration object.

3. **Ignored Files**:
   - Define ignored files in the `.gitignore` or `.ignore` files in your project root.
   - Use the `loadGitignore` and `loadIgnore` functions to load these settings into the configuration object.

4. **Project Configuration**:
   - Define project-specific settings in the `.coco.config.json` file in your project root.
   - Use the `loadProjectJsonConfig` function to load these settings into the configuration object.

5. **XDG Configuration**:
   - Define configuration settings in the `coco/config.json` file within the XDG config home directory.
   - Use the `loadXDGConfig` function to load these settings into the configuration object.
