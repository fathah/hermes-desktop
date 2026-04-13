<img width="100%" alt="HERMES DESKTOP" src="https://github.com/user-attachments/assets/80585955-3bae-4aee-af90-a1e61757ccb8" />

<br/>
<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/fathah/hermes-desktop/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://github.com/fathah/hermes-desktop/releases/"><img src="https://img.shields.io/badge/Download-Releases-FF6600?style=for-the-badge" alt="Releases"></a>
</p>

> **This project is in active development.** Features may change, and some things might break. If you run into a problem or have an idea, [open an issue](https://github.com/fathah/hermes-desktop/issues). Contributions are welcome!

## Languages

- English: `README.md`
- 简体中文: `README.zh-CN.md`

Hermes Desktop is a desktop app for installing, configuring, and chatting with [Hermes Agent](https://github.com/NousResearch/hermes-agent) from a native desktop interface.

Instead of asking you to manage the CLI by hand, the app walks through install, provider setup, and day-to-day usage in one place. It uses the official Hermes install script, stores Hermes in `~/.hermes`, and gives you a GUI for chat, sessions, profiles, memory, skills, tools, and settings.

## Install

Download the latest build from the [Releases](https://github.com/fathah/hermes-desktop/releases/) page.

| Platform | File                  |
| -------- | --------------------- |
| macOS    | `.dmg`                |
| Linux    | `.AppImage` or `.deb` |

> **macOS users:** The app is not code-signed or notarized. macOS will block it on first launch. To fix this, run the following after installing:
>
> ```bash
> xattr -cr "/Applications/Hermes Agent.app"
> ```
>
> Or right-click the app → **Open** → click **Open** in the confirmation dialog.

## What It Includes

- Guided first-run install for Hermes Agent
- Provider setup for OpenRouter, Anthropic, OpenAI, or local OpenAI-compatible endpoints
- Streaming chat UI backed by the Hermes CLI
- Session history with resume and search support
- Profile switching for separate Hermes environments
- GUI access to persona, memory, tools, and installed skills
- Gateway controls for Hermes messaging integrations
- Desktop packaging with Electron Builder

## Preview

<table>
<tr>
<td width="50%" align="center"><b>Office</b><br/><img width="100%" alt="Office" src="https://github.com/user-attachments/assets/214bfa60-48ec-4449-be40-370628205147" /></td>
<td width="50%" align="center"><b>Chat</b><br/><img width="100%" alt="Chat" src="https://github.com/user-attachments/assets/ca84a56c-4d14-4775-96bb-c725069988be" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Profiles</b><br/><img width="100%" alt="Profiles" src="https://github.com/user-attachments/assets/bd812e4a-bbdc-4141-b3a8-1ab5b0e561d4" /></td>
<td width="50%" align="center"><b>Tools</b><br/><img width="100%" alt="Tools" src="https://github.com/user-attachments/assets/ad051fbe-055d-40d2-b6dd-959c522412d2" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Settings</b><br/><img width="100%" alt="Settings" src="https://github.com/user-attachments/assets/b3f7e0d8-b087-4935-b57c-f8db30491f2e" /></td>
<td width="50%" align="center"><b>Skills</b><br/><img width="100%" alt="Skills" src="https://github.com/user-attachments/assets/508c3501-52eb-419d-8cfd-06268875ff62" /></td>
</tr>
</table>

## How It Works

On first launch, the app:

1. Checks whether Hermes is already installed in `~/.hermes`.
2. If not installed, runs the official Hermes installer.
3. Prompts for an API provider or local model endpoint.
4. Saves provider config and API keys through Hermes config files.
5. Launches the main workspace once setup is complete.

Chat requests are sent through the local Hermes CLI, and the desktop app streams the response back into the UI.

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

## Contributing

Contributions are welcome! Check out the [Contributing Guide](CONTRIBUTING.md) to get started. If you're not sure where to begin, take a look at the [open issues](https://github.com/NousResearch/hermes-desktop/issues). Found a bug or have a feature request? [File an issue](https://github.com/NousResearch/hermes-desktop/issues/new).

## Related Project

For the core agent, docs, and CLI workflows, see the main Hermes Agent repository:

- https://github.com/NousResearch/hermes-agent
