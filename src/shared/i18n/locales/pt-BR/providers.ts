export default {
  title: "Provedores",
  subtitle: "Configure provedores de LLM, chaves de API e pools de credenciais",
  oauth: {
    sectionTitle: "Assinaturas / Planos OAuth",
    sectionHint:
      "Faça login com uma assinatura do provedor em vez de uma chave de API. A autorização acontece no navegador.",
    signIn: "Entrar",
    runningHint: "Siga os passos abaixo para concluir o login.",
    successHint:
      "Login efetuado com sucesso. Agora você pode selecionar este provedor.",
    failed: "Falha no login.",
    codexDesc: "Use seu plano ChatGPT Codex",
    xaiDesc: "Use sua assinatura do xAI Grok",
    qwenDesc: "Use sua assinatura do Qwen",
    geminiDesc: "Use seu plano Google AI Pro / Gemini",
    minimaxDesc: "Use sua assinatura do MiniMax",
  },
} as const;
