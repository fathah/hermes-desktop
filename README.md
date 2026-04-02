
<img width="100%" alt="HERMES (1)" src="https://github.com/user-attachments/assets/9dba2a68-52c9-47e2-955c-3f8ef3e9e9c1" />
<br/><br/>
<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
</p>

Hermes Desktop is a desktop app for installing, configuring, and chatting with [Hermes Agent](https://github.com/NousResearch/hermes-agent) from a native desktop interface.

Instead of asking you to manage the CLI by hand, the app walks through install, provider setup, and day-to-day usage in one place. It uses the official Hermes install script, stores Hermes in `~/.hermes`, and gives you a GUI for chat, sessions, profiles, memory, skills, tools, and settings.

## What It Includes

- Guided first-run install for Hermes Agent
- Provider setup for OpenRouter, Anthropic, OpenAI, or local OpenAI-compatible endpoints
- Streaming chat UI backed by the Hermes CLI
- Session history with resume and search support
- Profile switching for separate Hermes environments
- GUI access to persona, memory, tools, and installed skills
- Gateway controls for Hermes messaging integrations
- Desktop packaging with Electron Builder

## How It Works

On first launch, the app:

1. Checks whether Hermes is already installed in `~/.hermes`.
2. If not installed, runs the official Hermes installer.
3. Prompts for an API provider or local model endpoint.
4. Saves provider config and API keys through Hermes config files.
5. Launches the main workspace once setup is complete.

Chat requests are sent through the local Hermes CLI, and the desktop app streams the response back into the UI.

## Tech Stack

- Electron
- React
- TypeScript
- Vite via `electron-vite`
- Electron Builder

## Project Structure

```text
src/main/                Electron main process, IPC handlers, Hermes integration
src/preload/             Secure renderer bridge
src/renderer/src/        React app and UI components
resources/               App icons and packaged assets
build/                   Packaging resources
```

## Development

### Prerequisites

- Node.js and npm
- A Unix-like shell environment for the Hermes installer
- Network access for downloading Hermes during first-run install

### Install dependencies

```bash
npm install
```

### Start the app in development

```bash
npm run dev
```

### Run checks

```bash
npm run lint
npm run typecheck
```

### Build the desktop app

```bash
npm run build
```

Platform packaging:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

## First-Time Setup

When the app opens for the first time, it will either detect an existing Hermes installation or offer to install it for you.

Supported setup paths in the UI:

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- `Local LLM` via an OpenAI-compatible base URL

Local presets are included for:

- LM Studio
- Ollama
- vLLM
- llama.cpp

Hermes files are managed in:

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`

## Main Screens

- `Chat`: talk to Hermes with streamed responses
- `Sessions`: browse and reopen past conversations
- `Agents`: manage and switch active profiles
- `Skills`: inspect bundled and installed skills
- `Persona`: edit the active profile's soul/persona
- `Memory`: view profile memory files
- `Tools`: enable or disable toolsets
- `Settings`: provider and gateway-related configuration

## Notes

- The desktop app depends on the upstream Hermes Agent project for agent behavior and tool execution.
- The built-in installer runs the official Hermes install script with `--skip-setup`, then completes provider configuration in the GUI.
- Local model providers do not require an API key, but the compatible server must already be running.

## Related Project

For the core agent, docs, and CLI workflows, see the main Hermes Agent repository:

- https://github.com/NousResearch/hermes-agent
