export default {
  title: "제공자",
  subtitle: "LLM 제공자, API 키, 자격 증명 풀을 구성하세요",
  oauth: {
    sectionTitle: "구독 / OAuth 플랜",
    sectionHint:
      "API 키 대신 제공자 구독으로 로그인하세요. 브라우저에서 인증이 진행됩니다.",
    signIn: "로그인",
    runningHint: "아래 단계를 따라 로그인을 완료하세요.",
    successHint: "로그인 성공. 이제 이 제공자를 선택할 수 있습니다.",
    failed: "로그인 실패.",
    codexDesc: "ChatGPT Codex 플랜 사용",
    xaiDesc: "xAI Grok 구독 사용",
    qwenDesc: "Qwen 구독 사용",
    geminiDesc: "Google AI Pro / Gemini 플랜 사용",
    minimaxDesc: "MiniMax 구독 사용",
    nousDesc: "Nous Portal 구독으로 로그인",
  },
} as const;
