export default {
  title: "Провайдеры",
  subtitle: "Настройте LLM-провайдеров, API keys и пулы учетных данных",
  oauth: {
    sectionTitle: "Подписки / OAuth-планы",
    sectionHint:
      "Войдите через подписку провайдера вместо API key. Авторизация происходит в браузере.",
    signIn: "Войти",
    runningHint: "Следуйте шагам ниже, чтобы завершить вход.",
    successHint: "Вход выполнен. Теперь можно выбрать этого провайдера.",
    failed: "Не удалось войти.",
    codexDesc: "Использовать ваш план ChatGPT Codex",
    xaiDesc: "Использовать вашу подписку xAI Grok",
    qwenDesc: "Использовать вашу подписку Qwen",
    geminiDesc: "Использовать ваш план Google AI Pro / Gemini",
    minimaxDesc: "Использовать вашу подписку MiniMax",
    nousDesc: "Войти через подписку Nous Portal",
  },
} as const;
