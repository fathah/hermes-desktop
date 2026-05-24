export default {
  title: "プロバイダ",
  subtitle: "LLM プロバイダ、API キー、認証情報プールを設定します",
  oauth: {
    sectionTitle: "サブスクリプション / OAuth プラン",
    sectionHint:
      "API キーの代わりにプロバイダのサブスクリプションでサインインします。認証はブラウザで行われます。",
    signIn: "サインイン",
    runningHint: "以下の手順に従ってサインインを完了してください。",
    successHint:
      "サインインに成功しました。このプロバイダを選択できます。",
    failed: "サインインに失敗しました。",
    codexDesc: "ChatGPT Codex プランを使用",
    xaiDesc: "xAI Grok のサブスクリプションを使用",
    qwenDesc: "Qwen のサブスクリプションを使用",
    geminiDesc: "Google AI Pro / Gemini プランを使用",
    minimaxDesc: "MiniMax のサブスクリプションを使用",
  },
} as const;
