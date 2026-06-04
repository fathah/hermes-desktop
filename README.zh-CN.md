<img width="100%" alt="HERMES DESKTOP" src="previews/header.webp" />

<br/>
<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="文档"></a>
  <a href="https://t.me/hermes_agent_desktop"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>
  <a href="https://github.com/fathah/hermes-desktop/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://hermesagents.cc/"><img src="https://img.shields.io/badge/Download-Releases-FF6600?style=for-the-badge" alt="下载"></a>
<a href="https://github.com/fathah/hermes-desktop/stargazers">
  <img src="https://img.shields.io/github/stars/fathah/hermes-desktop?style=for-the-badge&color=FFD700&label=Stars" alt="Stars">
</a>
  <a href="https://github.com/fathah/hermes-desktop/releases/">
  <img src="https://img.shields.io/github/downloads/fathah/hermes-desktop/total?style=for-the-badge&color=00B496&label=Total%20Downloads" alt="下载量">
</a>
</p>

> **本项目处于活跃开发阶段。** 功能可能会发生变化，某些功能也可能会失效。如果您遇到问题或有好的想法，请 [提交 Issue](https://github.com/fathah/hermes-desktop/issues)。欢迎贡献代码！

## 语言

- English: `README.md`
- 简体中文: `README.zh-CN.md`
- 日本語: `README.ja-JP.md`

Hermes Desktop 是一款原生的桌面应用程序，用于安装、配置并与 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 进行聊天——这是一款具备工具调用、多平台消息传递和闭环学习能力的自我进化的 AI 助手。

无需手动管理命令行界面 (CLI)，该应用可在一个统一界面中引导您完成安装、提供商设置以及日常使用。它使用官方的 Hermes 安装脚本，将 Hermes 存储在 `~/.hermes` 目录下，并为您提供涵盖聊天、会话、配置、记忆、技能、工具、计划任务、消息网关等功能的图形界面。

## 安装

<a href="https://hermesagents.cc/"><img width="380" alt="Download Now" src="previews/download.webp" /></a>

### Windows

> **Windows 用户注意：** 安装程序未进行代码签名。首次启动时 Windows SmartScreen 会弹出警告——请点击“更多信息” → “仍要运行”。

> **WSL 用户注意：** 如果安装程序停滞在 `Switching to root user to install dependencies...`，这说明 Playwright 正在等待输入 sudo 密码，但在没有 TTY 的情况下无法读取。请在安装期间授予无密码的 sudo 权限，完成后再恢复：
>
> ```bash
> echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/hermes-install
> # …重新运行安装程序；完成后执行：
> sudo rm /etc/sudoers.d/hermes-install
> ```
>
> 详情请见 [#109](https://github.com/fathah/hermes-desktop/issues/109)。

### Fedora (RPM)

```bash
sudo dnf install ./hermes-desktop-<version>.rpm
```

> **Fedora 用户注意：** `.rpm` 包没有 GPG 签名。如果您的系统强制检查签名，请在安装命令后添加 `--nogpgcheck`。`.rpm` 构建不支持自动更新（这是 `electron-updater` 的限制）；若要更新，请重新安装新的 `.rpm` 包。

## 预览

<table>
<tr>
<td width="50%" align="center"><b>聊天 (Chat)</b><br/><img width="100%" alt="Chat" src="previews/chat.png" /></td>
<td width="50%" align="center"><b>配置 (Profiles)</b><br/><img width="100%" alt="Profiles" src="previews/profiles.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>模型 (Models)</b><br/><img width="100%" alt="Models" src="previews/models.png" /></td>
<td width="50%" align="center"><b>提供商 (Providers)</b><br/><img width="100%" alt="Providers" src="previews/providers.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>工具 (Tools)</b><br/><img width="100%" alt="Tools" src="previews/tools.png" /></td>
<td width="50%" align="center"><b>技能 (Skills)</b><br/><img width="100%" alt="Skills" src="previews/skills.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>计划任务 (Schedules)</b><br/><img width="100%" alt="Schedules" src="previews/schedules.png" /></td>
<td width="50%" align="center"><b>网关 (Gateway)</b><br/><img width="100%" alt="Gateway" src="previews/gateway.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>人格 (Persona)</b><br/><img width="100%" alt="Persona" src="previews/persona.png" /></td>
<td width="50%" align="center"><b>看板 (Kanban)</b><br/><img width="100%" alt="Kanban" src="previews/kanban.png" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>办公室 (Office)</b><br/><img width="100%" alt="Office" src="previews/office.png" /></td>
<td width="50%" align="center"><b>设置 (Settings)</b><br/><img width="100%" alt="Settings" src="previews/settings.png" /></td>
</tr>
</table>

## 功能特性

- **向导式初次安装**：带有进度跟踪和依赖解析的 Hermes Agent 引导安装。
- **本地或远程后端**：可在本地 `127.0.0.1:8642` 运行 Hermes，或通过 URL 和 API 密钥将桌面应用连接到远程的 Hermes API 服务器。
- **多提供商支持**：OpenRouter, Anthropic, OpenAI, Google (Gemini), xAI (Grok), Nous Portal, Qwen, MiniMax, Hugging Face, Groq, 以及本地兼容 OpenAI 格式的端点 (LM Studio, Ollama, vLLM, llama.cpp)。
- **流式聊天界面**：具有 SSE 流式传输、工具进度指示、Markdown 渲染和语法高亮。
- **Token 使用情况追踪**：在聊天底部显示实时的 Prompt/补全 Token 计数及预估费用，并可通过 `/usage` 斜杠命令查看。
- **22 个斜杠命令**：`/new`, `/clear`, `/fast`, `/web`, `/image`, `/browse`, `/code`, `/shell`, `/usage`, `/help`, `/tools`, `/skills`, `/model`, `/memory`, `/persona`, `/version`, `/compact`, `/compress`, `/undo`, `/retry`, `/debug`, `/status` 等等。
- **会话管理**：全文检索 (SQLite FTS5)、按日期分组的历史记录、在会话之间继续聊天或搜索。
- **配置切换 (Profile)**：创建、删除并切换不同的 Hermes 环境，配置完全隔离。
- **14 种工具集**：网络、浏览器、终端、文件、代码执行、视觉识别、图像生成、语音合成 (TTS)、技能、记忆、会话搜索、澄清询问、委托调度、混合专家模型 (MoA) 和任务规划。
- **记忆系统**：查看/编辑记忆条目和用户资料记忆，追踪容量，并发现不同的记忆提供商（如 Honcho, Hindsight, Mem0, RetainDB, Supermemory, ByteRover）。
- **人格编辑器**：编辑并重置您的代理 (Agent) 的 `SOUL.md` 人格设定。
- **已保存模型**：跨不同提供商对模型配置进行增删改查。
- **计划任务**：支持 15 种推送目标的 Cron 任务构建器（分钟、小时、每日、每周、自定义 Cron）。
- **16 个消息网关**：Telegram, Discord, Slack, WhatsApp, Signal, Matrix/Element, Mattermost, Email (IMAP/SMTP), SMS (Twilio & Vonage), iMessage (BlueBubbles), 钉钉 (DingTalk), 飞书 (Feishu/Lark), 企业微信 (WeCom), 微信 (WeChat iLink Bot), Webhooks 和 Home Assistant。
- **Hermes 办公室 (Claw3d)**：具有开发服务器和适配器管理功能的可视化 3D 界面。
- **备份、导入与诊断导出**：可在设置面板中完成完整的数据备份/恢复，并进行系统诊断。
- **日志查看器**：直接在设置界面中查看网关和代理的运行日志。
- **自动更新**：通过 `electron-updater` 检查并安装更新。
- **国际化 (i18n)**：预置英文语言环境，涵盖所有界面，并已为社区翻译做好框架准备。
- **测试套件**：涵盖 SSE 解析器、IPC 处理程序、预加载 API、安装程序工具以及常数验证的 Vitest 测试用例。

## 运行原理

在首次启动时，应用会：

1. 询问您是希望在**本地**运行 Hermes，还是连接到**远程**的 Hermes API 服务器。
2. **本地模式：** 检查 `~/.hermes` 目录下是否已安装 Hermes；如果未安装，则运行官方 Hermes 安装脚本并解决依赖关系 (Git, uv, Python 3.11+)。
3. **远程模式：** 提示输入远程 API URL 和 API 密钥，验证连接，并跳过本地安装。
4. 提示输入 API 提供商或本地模型端点。
5. 将提供商配置和 API 密钥保存至 Hermes 配置文件。
6. 设置完成后启动主工作区。

在本地模式下，聊天请求会通过带有 SSE 流的 `http://127.0.0.1:8642` 发送。在远程模式下，应用程序通过相同的流协议与您配置的远程 URL 进行通信。桌面应用会实时解析数据流，并在接收时渲染工具进度、Markdown 内容以及 token 消耗。

## 界面说明

| 界面 (Screen) | 描述 (Description)                                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| **聊天 (Chat)**      | 支持斜杠命令、工具进度展示和 token 跟踪的流式对话界面                                     |
| **会话 (Sessions)**  | 浏览、搜索并恢复过去的对话                                         |
| **代理 (Agents)**    | 创建、删除和在不同的 Hermes 配置 (Profile) 之间切换                                    |
| **技能 (Skills)**    | 浏览、安装并管理内置及已安装的技能                              |
| **模型 (Models)**    | 管理并保存各个提供商的模型配置                                        |
| **记忆 (Memory)**    | 查看/编辑记忆条目、用户配置，并配置记忆提供商                |
| **灵魂 (Soul)**      | 编辑当前活动配置的代理人格设定 (`SOUL.md`)                                           |
| **工具 (Tools)**     | 启用或禁用特定的工具集                                                 |
| **计划 (Schedules)** | 创建并管理定时任务及推送目标                                     |
| **网关 (Gateway)**   | 配置和控制各类消息平台集成                                 |
| **办公室 (Office)**    | Claw3d 可视化界面设置及管理                                          |
| **设置 (Settings)**  | 提供商配置、凭证池、备份/导入、日志查看器、网络设置、主题 |

## 支持的提供商

### 大语言模型 (LLM) 提供商

| 提供商 (Provider)   | 备注说明 (Notes)                                    |
| ------------------- | ---------------------------------------- |
| **OpenRouter**      | 通过单一 API 访问 200+ 种模型 (推荐使用) |
| **Anthropic**       | 直接访问 Claude 模型                     |
| **OpenAI**          | 直接访问 GPT 模型                        |
| **Google (Gemini)** | Google AI Studio                         |
| **xAI (Grok)**      | Grok 模型                              |
| **Nous Portal**     | 提供免费额度                      |
| **Qwen (通义千问)** | QwenAI 模型                            |
| **MiniMax**         | 包含全球与中国区端点               |
| **Hugging Face**    | 通过 HF Inference 访问 20+ 开源模型         |
| **Groq**            | 快速推理 (支持语音/STT)               |
| **本地/自定义 (Local/Custom)**    | 任何兼容 OpenAI 格式的端点           |

内置以下本地模型预设：LM Studio, Ollama, vLLM, llama.cpp。

### 消息平台

Telegram, Discord, Slack, WhatsApp, Signal, Matrix/Element, Mattermost, 电子邮件 (IMAP/SMTP), 短信 (Twilio & Vonage), iMessage (BlueBubbles), 钉钉 (DingTalk), 飞书 (Feishu/Lark), 企业微信 (WeCom), 微信 (WeChat iLink Bot), Webhooks 和 Home Assistant。

### 工具集成

Exa Search, Parallel API, Tavily, Firecrawl, FAL.ai (图像生成), Honcho, Browserbase, Weights & Biases 和 Tinker。

## 开发

### 前置要求

- Node.js 和 npm
- 能够运行 Hermes 安装程序的类 Unix Shell 环境
- 首次运行安装 Hermes 时需要网络连接

### 安装依赖

```bash
npm install
```

### 在开发模式下启动应用

```bash
npm run dev
```

### 运行检查

```bash
npm run lint
npm run typecheck
```

### 运行测试

```bash
npm run test
npm run test:watch
```

### 构建桌面应用

```bash
npm run build
```

各平台打包命令：

```bash
npm run build:mac
npm run build:win
npm run build:linux
npm run build:rpm    # 仅适用于 Fedora/RHEL 的 .rpm 格式
```

## 首次运行设置

当应用首次打开时，它会自动检测是否存在已安装的 Hermes 实例，或者提供帮您进行自动安装的选项。

UI 中支持的设置路径：

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- 通过兼容 OpenAI API 基础 URL 接入的 `本地大语言模型 (Local LLM)`

内置预设包含：

- LM Studio
- Ollama
- vLLM
- llama.cpp

Hermes 的相关文件统一管理于以下目录：

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`
- `~/.hermes/profiles/` — 命名配置文件目录
- `~/.hermes/state.db` — 会话历史数据库
- `~/.hermes/cron/jobs.json` — 计划任务

## 技术栈

- **Electron 39** — 跨平台桌面外壳
- **React 19** — UI 框架
- **TypeScript 5.9** — 跨主进程和渲染进程的类型安全
- **Tailwind CSS 4** — 实用优先的样式库
- **Vite 7 + electron-vite** — 快速开发服务器及构建工具
- **better-sqlite3** — 带有 FTS5 全文搜索功能的本地会话存储
- **i18next** — 国际化框架
- **Vitest** — 测试运行器

## 注意事项

- 此桌面应用依赖上游的 Hermes Agent 项目来处理代理行为和工具执行。
- 内置安装程序会通过带有 `--skip-setup` 参数的方式运行官方 Hermes 安装脚本，然后在 GUI 界面中完成提供商相关的配置。
- 本地模型提供商不需要 API 密钥，但您必须确保兼容的服务器已经在运行中。
- 在网络受限的环境下，支持配置备用的 npm 镜像源路由。

## 参与贡献

欢迎大家参与贡献！查看 [参与贡献指南 (Contributing Guide)](CONTRIBUTING.md) 以开始。如果您不知从何入手，可以看一看 [开启的 Issues](https://github.com/NousResearch/hermes-desktop/issues)。发现了 Bug 或是对功能有新的需求？ [提交一个 Issue](https://github.com/NousResearch/hermes-desktop/issues/new)。

## 相关项目

如果想了解核心代理功能、详细文档及命令行 (CLI) 的工作流程，请查阅主仓库 Hermes Agent：

- https://github.com/NousResearch/hermes-agent
