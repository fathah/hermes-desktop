# Hermes Desktop へのコントリビューション

Hermes Desktop へのコントリビューションに興味を持っていただきありがとうございます！バグ修正、新機能、ドキュメント改善、ちょっとしたタイポ修正まで、どんな貢献も歓迎します。

## 言語

- English: `CONTRIBUTING.md`
- 简体中文: `CONTRIBUTING.zh-CN.md`
- 日本語: `CONTRIBUTING.ja-JP.md`

## はじめに

1. リポジトリを **Fork** し、ローカルにクローンします。
2. **依存関係をインストール:**

   ```bash
   npm install
   ```

3. **開発モードでアプリを起動:**

   ```bash
   npm run dev
   ```

## 変更を加える

1. `main` から新しいブランチを作成します。

   ```bash
   git checkout -b your-branch-name
   ```

2. 変更を加えます。コミットは目的を絞って — 1 つの論理的な変更につき 1 つのコミットを心掛けてください。

3. 提出前にチェックを実行します。

   ```bash
   npm run lint
   npm run typecheck
   ```

4. `npm run dev` でローカル動作確認を行い、期待通りに動くことを確認してください。

## プルリクエストの提出

1. ブランチを自分の fork に push します。
2. 上流リポジトリの `main` に対してプルリクエストを開きます。
3. 変更内容とその理由を明確に記述してください。
4. PR が Open Issue に対応する場合は、参照を記述してください（例: `Fixes #42`）。

### プルリクエストは小さく保つ

PR は小さく目的を絞ってください — その方がレビューもマージもずっと容易になります。多くのファイルに触れる PR や、無関係な変更をまとめた PR は、分割を依頼されたり、受け入れられない場合があります。

- 1 つの PR につき 1 つの論理的な変更（1 つの修正、1 つの機能、1 つのリファクタリング）に絞ってください。
- 無関係なファイルを多数触っていることに気づいたら、作業を複数の PR に分割してください。
- フォーマット / スタイルの一括変更を機能変更と混在させないでください。
- 小さな PR ほど、レビューとマージが速くなります。

メンテナが PR をレビューし、変更を依頼する場合があります。承認されるとマージされます。

## バグ報告

バグを見つけた場合は、以下の情報を添えて [Issue を作成してください](https://github.com/NousResearch/hermes-desktop/issues/new)。

- 明確なタイトルと説明
- 再現手順
- 期待される動作と実際の動作
- 必要に応じて OS とアプリのバージョン

## 機能リクエスト

アイデアがある場合は、[Issue を作成して](https://github.com/NousResearch/hermes-desktop/issues/new)以下を記述してください。

- 解決したい問題
- どのように動作してほしいか
- 検討した代替案

## プロジェクト構成

```text
src/main/                Electron メインプロセス、IPC ハンドラ、Hermes 統合
src/preload/             セキュアな renderer ブリッジ
src/renderer/src/        React アプリと UI コンポーネント
resources/               アプリアイコンとパッケージ用アセット
build/                   パッケージング用リソース
```

## コードスタイル

- 本プロジェクトでは TypeScript、React、Electron を使用しています。
- Lint エラーを確認するには `npm run lint` を実行してください。
- 型の安全性を検証するには `npm run typecheck` を実行してください。
- コードベース内の既存のパターンや慣習に従ってください。

## コミュニティ

- 他のコントリビューターと話すには [Nous Research Discord](https://discord.gg/NousResearch) に参加してください。
- Hermes の動作についての詳細は[ドキュメント](https://hermes-agent.nousresearch.com/docs/)を参照してください。

## ライセンス

コントリビューションをいただいた時点で、その内容が [MIT License](LICENSE) の下でライセンスされることに同意したものとみなします。
