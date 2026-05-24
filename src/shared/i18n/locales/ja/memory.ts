export default {
  title: "メモリ",
  subtitle:
    "Hermes がセッションを跨いで覚えているあなたと環境に関する情報です。",
  sessions: "セッション",
  messages: "メッセージ",
  memories: "メモリ",
  providersTitle: "プロバイダ",
  agentMemory: "エージェントメモリ",
  userProfile: "ユーザープロファイル",
  entries: "{{count}} 件",
  addMemory: "メモリを追加",
  addFailed: "エントリの追加に失敗しました",
  updateFailed: "エントリの更新に失敗しました",
  saveFailed: "保存に失敗しました",
  entriesPlaceholder:
    "例：ユーザーは JavaScript より TypeScript を好む。常に strict モードを使用する。",
  userProfilePlaceholder:
    "例：名前：Alex。シニア開発者。簡潔な回答を好む。macOS と zsh を使用。タイムゾーン：JST。",
  noProvidersFound: "このインストールにはメモリプロバイダが見つかりません。",
  openProviderWebsite: "プロバイダのウェブサイトを開く",
  noMemoriesYet:
    "まだメモリがありません。Hermes はチャットを通じて重要な事実を保存します。",
  noMemoryEntries: "メモリエントリがまだありません。",
  noToolsetsFound: "ツールセットが見つかりません。",
  addManuallyHint: "上のボタンから手動でメモリを追加することもできます。",
  userProfileHint:
    "あなた自身について Hermes に教えてください — 名前、役割、好み、コミュニケーションスタイルなど。",
  providersHint:
    "プラガブルなメモリプロバイダは Hermes に高度な長期記憶を与えます。組み込みメモリ（上）は選択したプロバイダと並行して常時動作します。",
  providersHintActive: "稼働中：<strong>{{provider}}</strong>",
  providersHintInactive: "外部プロバイダ未使用 — 組み込みのみ利用中。",
  enterEnvKey: "{{key}} を入力",
  chars: "{{count}} 文字",
  cancel: "キャンセル",
  save: "保存",
  edit: "編集",
  deleteConfirm: "削除しますか？",
  yes: "はい",
  no: "いいえ",
  saveProfile: "プロファイルを保存",
  active: "稼働中",
  deactivate: "無効化",
  activating: "有効化中...",
  activate: "有効化",
  providers: {
    honcho:
      "弁証法的 Q&A と意味検索を備えた AI ネイティブのセッション横断ユーザーモデリング",
    hindsight: "ナレッジグラフと複数戦略の検索を備えた長期メモリ",
    mem0: "サーバ側 LLM 事実抽出・意味検索・自動重複除去",
    retaindb: "ハイブリッド検索と 7 種類のメモリを備えたクラウドメモリ API",
    supermemory: "プロファイル想起とエンティティ抽出を備えた意味的長期メモリ",
    holographic:
      "FTS5 検索と信頼度スコアリング付きローカル SQLite 事実ストア（API キー不要）",
    openviking: "階層型検索とナレッジブラウジングを備えたセッション管理メモリ",
    byterover: "brv CLI 経由の階層型検索付き永続ナレッジツリー",
  },
} as const;
