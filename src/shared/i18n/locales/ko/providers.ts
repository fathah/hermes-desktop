export default {
  title: "공급자",
  subtitle: "LLM 공급자, API 키 및 인증 풀 구성",
  oauth: {
    sectionTitle: "구독 / OAuth 플랜",
    sectionHint:
      "API 키 대신 공급자 구독으로 로그인하세요. 브라우저에서 인증이 이루어집니다.",
    signIn: "로그인",
    runningHint: "아래 단계를 따라 로그인을 완료하세요.",
    successHint: "성공적으로 로그인했습니다. 이제 이 공급자를 선택할 수 있습니다.",
    failed: "로그인 실패.",
    codexDesc: "ChatGPT Codex 플랜 사용",
    xaiDesc: "xAI Grok 구독 사용",
    qwenDesc: "Qwen 구독 사용",
    geminiDesc: "Google AI Pro / Gemini 플랜 사용",
    minimaxDesc: "MiniMax 구독 사용",
    nousDesc: "Nous Portal 구독으로 로그인",
  },
} as const;
