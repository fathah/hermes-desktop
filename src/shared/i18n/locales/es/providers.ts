export default {
  title: "Proveedores",
  subtitle: "Configura proveedores de LLM, API keys y grupos de credenciales",
  oauth: {
    sectionTitle: "Suscripciones / Planes OAuth",
    sectionHint:
      "Inicia sesión con una suscripción del proveedor en lugar de una API key. La autorización se realiza en tu navegador.",
    signIn: "Iniciar sesión",
    runningHint:
      "Sigue los pasos de abajo para completar el inicio de sesión.",
    successHint:
      "Sesión iniciada correctamente. Ya puedes seleccionar este proveedor.",
    failed: "Error al iniciar sesión.",
    codexDesc: "Usa tu plan ChatGPT Codex",
    xaiDesc: "Usa tu suscripción de xAI Grok",
    qwenDesc: "Usa tu suscripción de Qwen",
    geminiDesc: "Usa tu plan Google AI Pro / Gemini",
    minimaxDesc: "Usa tu suscripción de MiniMax",
  },
} as const;
