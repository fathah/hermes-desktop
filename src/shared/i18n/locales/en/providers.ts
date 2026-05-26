export default {
  title: "Providers",
  subtitle: "Configure LLM providers, API keys, and credential pools",
  oauth: {
    sectionTitle: "Subscription / OAuth Plans",
    sectionHint:
      "Sign in with a provider subscription instead of an API key. Authorization happens in your browser.",
    signIn: "Sign in",
    runningHint: "Follow the steps below to finish signing in.",
    successHint: "Signed in successfully. You can now select this provider.",
    failed: "Sign-in failed.",
    codexDesc: "Use your ChatGPT Codex plan",
    xaiDesc: "Use your xAI Grok subscription",
    qwenDesc: "Use your Qwen subscription",
    geminiDesc: "Use your Google AI Pro / Gemini plan",
    minimaxDesc: "Use your MiniMax subscription",
    nousDesc: "Sign in with your Nous Portal subscription",
  },
} as const;
