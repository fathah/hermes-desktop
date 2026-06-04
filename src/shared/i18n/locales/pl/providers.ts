export default {
  title: "Dostawcy",
  subtitle: "Konfiguruj dostawców LLM, klucze API i pule poświadczeń",
  oauth: {
    sectionTitle: "Plany subskrypcyjne / OAuth",
    sectionHint:
      "Zaloguj się przez subskrypcję dostawcy zamiast klucza API. Autoryzacja odbywa się w przeglądarce.",
    signIn: "Zaloguj",
    runningHint: "Wykonaj poniższe kroki, aby dokończyć logowanie.",
    successHint: "Zalogowano pomyślnie. Możesz teraz wybrać tego dostawcę.",
    failed: "Logowanie nie powiodło się.",
    codexDesc: "Użyj swojego planu ChatGPT Codex",
    xaiDesc: "Użyj swojej subskrypcji xAI Grok",
    qwenDesc: "Użyj swojej subskrypcji Qwen",
    geminiDesc: "Użyj swojego planu Google AI Pro / Gemini",
    minimaxDesc: "Użyj swojej subskrypcji MiniMax",
    nousDesc: "Zaloguj się przez subskrypcję Nous Portal",
  },
} as const;
