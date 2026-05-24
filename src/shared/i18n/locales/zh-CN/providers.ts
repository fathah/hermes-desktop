export default {
  title: "提供商",
  subtitle: "配置 LLM 提供商、API 密钥和凭据池",
  oauth: {
    sectionTitle: "订阅 / OAuth 套餐",
    sectionHint: "使用提供商订阅而非 API 密钥登录。授权在浏览器中完成。",
    signIn: "登录",
    runningHint: "请按照下方步骤完成登录。",
    successHint: "登录成功。现在可以选择此提供商。",
    failed: "登录失败。",
    codexDesc: "使用您的 ChatGPT Codex 套餐",
    xaiDesc: "使用您的 xAI Grok 订阅",
    qwenDesc: "使用您的 Qwen 订阅",
    geminiDesc: "使用您的 Google AI Pro / Gemini 套餐",
    minimaxDesc: "使用您的 MiniMax 订阅",
  },
} as const;
