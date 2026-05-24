export default {
  title: "ツール",
  subtitle: "会話中にエージェントが使えるツールセットを有効化／無効化",
  web: {
    label: "Web 検索",
    description: "Web を検索し、URL からコンテンツを抽出",
  },
  browser: {
    label: "ブラウザ",
    description: "Web ページを巡回・クリック・入力・操作",
  },
  terminal: {
    label: "ターミナル",
    description: "シェルコマンドとスクリプトを実行",
  },
  file: {
    label: "ファイル操作",
    description: "ファイルの読み書き・検索・管理",
  },
  code_execution: {
    label: "コード実行",
    description: "Python とシェルコードを直接実行",
  },
  vision: { label: "Vision", description: "画像と視覚コンテンツを分析" },
  image_gen: {
    label: "画像生成",
    description: "DALL-E など各種モデルで画像を生成",
  },
  tts: { label: "音声合成", description: "テキストを音声に変換" },
  skills: {
    label: "スキル",
    description: "再利用可能なスキルの作成・管理・実行",
  },
  memory: {
    label: "メモリ",
    description: "永続的な知識の保存と呼び出し",
  },
  session_search: {
    label: "セッション検索",
    description: "過去の会話を横断検索",
  },
  clarify: {
    label: "確認質問",
    description: "必要に応じてユーザーに確認を求める",
  },
  delegation: {
    label: "委任",
    description: "並列タスクのためにサブエージェントを生成",
  },
  cronjob: {
    label: "Cron ジョブ",
    description: "スケジュールタスクの作成・管理",
  },
  moa: {
    label: "Mixture of Agents",
    description: "複数の AI モデルを協調動作させる",
  },
  todo: {
    label: "タスク計画",
    description: "複雑なタスク用の TODO リストを作成・管理",
  },
  mcpServers: "MCP サーバ",
  mcpDescription:
    "config.yaml で構成された Model Context Protocol サーバ。ターミナルで <code>hermes mcp add/remove</code> から管理します。",
  http: "HTTP",
  stdio: "stdio",
  disabled: "無効",
} as const;
