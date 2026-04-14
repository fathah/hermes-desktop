# Hermes Desktop

<img width="100%" alt="HERMES DESKTOP" src="https://github.com/user-attachments/assets/80585955-3bae-4aee-af90-a1e61757ccb8" />

## 语言

- 英文：`README.md`
- 简体中文：`README.zh-CN.md`

> **本项目仍在积极开发中。** 功能可能会变化，部分内容也可能出现问题。如果你遇到 bug 或有新的想法，欢迎在 GitHub 上提交 issue。

Hermes Desktop 是一个桌面应用，用于通过原生桌面界面安装、配置并与 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 进行交互。

它把安装、提供商配置和日常使用整合到同一个图形界面中，而不是要求你手动维护 CLI。应用会调用官方 Hermes 安装脚本，将 Hermes 存储在 `~/.hermes` 中，并提供聊天、会话、档案、记忆、技能、工具和设置等 GUI 功能。

## 安装

请从 [Releases](https://github.com/fathah/hermes-desktop/releases/) 页面下载最新构建版本。

| 平台  | 文件                  |
| ----- | --------------------- |
| macOS | `.dmg`                |
| Linux | `.AppImage` 或 `.deb` |

> **macOS 用户：** 应用目前没有进行代码签名或 notarize，首次启动时 macOS 可能会阻止运行。安装后请执行：
>
> ```bash
> xattr -cr "/Applications/Hermes Agent.app"
> ```
>
> 或者右键应用，选择 **Open**，然后在弹窗中再次点击 **Open**。

## 功能包含

- Hermes Agent 的首次引导式安装
- OpenRouter、Anthropic、OpenAI 以及本地 OpenAI 兼容端点的提供商配置
- 基于 Hermes CLI 的流式聊天界面
- 带恢复和搜索能力的会话历史
- 用于隔离 Hermes 环境的档案切换
- 对人格、记忆、工具和已安装技能的图形界面访问
- Hermes 消息集成的网关控制
- 使用 Electron Builder 进行桌面打包

## 工作方式

首次启动时，应用会：

1. 检查 `~/.hermes` 中是否已经安装 Hermes。
2. 如果尚未安装，则运行官方 Hermes 安装程序。
3. 提示你选择 API 提供商或本地模型端点。
4. 通过 Hermes 配置文件保存提供商配置和 API Key。
5. 在设置完成后进入主工作区。

聊天请求会通过本地 Hermes CLI 发出，桌面应用再把响应流式回传到 UI 中。

## 开发

### 前置要求

- Node.js 和 npm
- 可运行 Hermes 安装器的类 Unix shell 环境
- 首次安装时用于下载 Hermes 的网络访问能力

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

### 运行检查

```bash
npm run lint
npm run typecheck
```

### 构建桌面应用

```bash
npm run build
```

平台构建：

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

## 首次设置

应用首次打开时，会自动检测是否存在现有 Hermes 安装；如果没有，会引导你完成安装。

当前 UI 支持的设置路径包括：

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- 通过 OpenAI 兼容 Base URL 使用 `Local LLM`

内置的本地预设包括：

- LM Studio
- Ollama
- vLLM
- llama.cpp

Hermes 相关文件位于：

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`

## 主界面

- `Chat`：与 Hermes 进行流式对话
- `Sessions`：浏览并重新打开历史会话
- `Agents`：管理和切换活动档案
- `Skills`：查看内置和已安装技能
- `Persona`：编辑当前档案的人格
- `Memory`：查看档案记忆文件
- `Tools`：启用或禁用工具集
- `Settings`：提供商和网关相关配置

## 说明

- 桌面应用依赖上游 Hermes Agent 项目来完成代理行为和工具执行。
- 内置安装器会以 `--skip-setup` 运行官方 Hermes 安装脚本，再在 GUI 中完成提供商配置。
- 本地模型提供商不需要 API Key，但兼容服务必须已经启动。

## 贡献

欢迎贡献！请查看 [贡献指南](CONTRIBUTING.zh-CN.md) 开始参与。如果你不知道从哪里入手，可以先看看 [open issues](https://github.com/NousResearch/hermes-desktop/issues)。如果你发现 bug 或希望提出功能请求，也欢迎 [提交 issue](https://github.com/NousResearch/hermes-desktop/issues/new)。

## 相关项目

如需了解核心代理、文档和 CLI 工作流，请查看 Hermes Agent 主仓库：

- https://github.com/NousResearch/hermes-agent
