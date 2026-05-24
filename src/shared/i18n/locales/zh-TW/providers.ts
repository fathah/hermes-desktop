export default {
  title: "供應商",
  subtitle: "設定 LLM 供應商、API 金鑰和憑證池",
  oauth: {
    sectionTitle: "訂閱 / OAuth 方案",
    sectionHint: "使用供應商訂閱而非 API 金鑰登入。授權在瀏覽器中完成。",
    signIn: "登入",
    runningHint: "請依照下方步驟完成登入。",
    successHint: "登入成功。現在可以選擇此供應商。",
    failed: "登入失敗。",
    codexDesc: "使用您的 ChatGPT Codex 方案",
    xaiDesc: "使用您的 xAI Grok 訂閱",
    qwenDesc: "使用您的 Qwen 訂閱",
    geminiDesc: "使用您的 Google AI Pro / Gemini 方案",
    minimaxDesc: "使用您的 MiniMax 訂閱",
  },
} as const;
