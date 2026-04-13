# Contributing to Hermes Desktop

Thanks for your interest in contributing to Hermes Desktop! Whether it's a bug fix, a new feature, improved docs, or just a typo — every contribution helps.

## Languages

- English: `CONTRIBUTING.md`
- 简体中文: `CONTRIBUTING.zh-CN.md`

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Start the app in development mode:**

   ```bash
   npm run dev
   ```

## Making Changes

1. Create a new branch from `main`:

   ```bash
   git checkout -b your-branch-name
   ```

2. Make your changes. Keep commits focused — one logical change per commit.

3. Run checks before submitting:

   ```bash
   npm run lint
   npm run typecheck
   ```

4. Test your changes locally with `npm run dev` to make sure everything works as expected.

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a pull request against `main` on the upstream repo.
3. Write a clear description of what you changed and why.
4. If your PR addresses an open issue, reference it (e.g., `Fixes #42`).

A maintainer will review your PR and may request changes. Once approved, it will be merged.

## Reporting Bugs

Found a bug? [Open an issue](https://github.com/NousResearch/hermes-desktop/issues/new) with:

- A clear title and description.
- Steps to reproduce the issue.
- What you expected to happen vs. what actually happened.
- Your OS and app version, if relevant.

## Requesting Features

Have an idea? [Open an issue](https://github.com/NousResearch/hermes-desktop/issues/new) and describe:

- The problem you're trying to solve.
- How you'd like it to work.
- Any alternatives you've considered.

## Project Structure

```text
src/main/                Electron main process, IPC handlers, Hermes integration
src/preload/             Secure renderer bridge
src/renderer/src/        React app and UI components
resources/               App icons and packaged assets
build/                   Packaging resources
```

## Code Style

- The project uses TypeScript, React, and Electron.
- Run `npm run lint` to check for lint errors.
- Run `npm run typecheck` to verify type safety.
- Follow existing patterns and conventions in the codebase.

## Community

- Join the [Nous Research Discord](https://discord.gg/NousResearch) to chat with other contributors.
- Check the [documentation](https://hermes-agent.nousresearch.com/docs/) for more context on how Hermes works.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
