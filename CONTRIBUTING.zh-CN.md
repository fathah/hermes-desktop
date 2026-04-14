# 为 Hermes Desktop 做贡献

感谢你愿意为 Hermes Desktop 做出贡献。无论是修复 bug、添加新功能、完善文档，还是修正一个拼写错误，每一份贡献都很有价值。

## 语言

- 英文：`CONTRIBUTING.md`
- 简体中文：`CONTRIBUTING.zh-CN.md`

## 快速开始

1. **Fork** 本仓库，并将你的 fork 克隆到本地。
2. **安装依赖：**

   ```bash
   npm install
   ```

3. **以开发模式启动应用：**

   ```bash
   npm run dev
   ```

## 修改代码

1. 从 `main` 创建新分支：

   ```bash
   git checkout -b your-branch-name
   ```

2. 完成你的改动。请保持提交聚焦，每个 commit 只做一类逻辑改动。

3. 提交前先运行检查：

   ```bash
   npm run lint
   npm run typecheck
   ```

4. 使用 `npm run dev` 在本地测试改动，确保行为符合预期。

## 提交 Pull Request

1. 将分支推送到你的 fork。
2. 在上游仓库中向 `main` 发起 Pull Request。
3. 清楚描述你改了什么，以及为什么这样改。
4. 如果你的 PR 解决了某个已有 issue，请在描述中引用它（例如：`Fixes #42`）。

维护者会审核你的 PR，并可能提出修改建议。审核通过后，PR 会被合并。

## 报告 Bug

如果你发现了 bug，请在 GitHub 上 [提交 issue](https://github.com/NousResearch/hermes-desktop/issues/new)，并尽量包含：

- 清晰的标题和描述
- 复现步骤
- 预期行为与实际行为
- 你的操作系统和应用版本（如果相关）

## 功能请求

如果你有新想法，也欢迎 [提交 issue](https://github.com/NousResearch/hermes-desktop/issues/new)，并描述：

- 你想解决的问题
- 你希望它如何工作
- 你考虑过的替代方案

## 项目结构

```text
src/main/                Electron 主进程、IPC 处理器、Hermes 集成
src/preload/             安全的 renderer bridge
src/renderer/src/        React 应用和 UI 组件
resources/               应用图标和打包资源
build/                   打包配置资源
```

## 代码风格

- 项目使用 TypeScript、React 和 Electron。
- 运行 `npm run lint` 检查 lint 错误。
- 运行 `npm run typecheck` 验证类型安全。
- 尽量遵循当前仓库现有模式和约定。

## 社区

- 欢迎加入 [Nous Research Discord](https://discord.gg/NousResearch)，与其他贡献者交流。
- 也可以查看 [文档](https://hermes-agent.nousresearch.com/docs/) 了解 Hermes 的整体工作方式。

## 许可证

通过提交贡献，即表示你同意你的贡献将按照 [MIT License](LICENSE) 授权。
