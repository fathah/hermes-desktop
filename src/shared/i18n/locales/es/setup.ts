export default {
  title: "Configura tu proveedor de IA",
  subtitle: "Elige un proveedor y configúralo para empezar",
  providerCards: {
    openrouter: {
      name: "OpenRouter",
      desc: "Más de 200 modelos",
      tag: "Recomendado",
    },
    anthropic: { name: "Anthropic", desc: "Modelos Claude", tag: "" },
    openai: { name: "OpenAI", desc: "Modelos GPT", tag: "" },
    local: {
      name: "Local / Compatible con OpenAI",
      desc: "LM Studio, Ollama, Groq, DeepSeek, Together…",
      tag: "",
    },
  },
  localPresets: {
    lmstudio: "LM Studio",
    ollama: "Ollama",
    vllm: "vLLM",
    llamacpp: "llama.cpp",
    groq: "Groq",
    deepseek: "DeepSeek",
    together: "Together AI",
    fireworks: "Fireworks",
    cerebras: "Cerebras",
    mistral: "Mistral",
  },
  serverPreset: "Preajuste de servidor",
  localGroupLabel: "Servidores locales",
  remoteGroupLabel: "APIs remotas compatibles con OpenAI",
  serverUrl: "URL base",
  modelName: "Nombre del modelo",
  localServerHint:
    "Asegúrate de que tu servidor local esté en ejecución antes de continuar",
  customServerHint:
    "Elige un preajuste o pega cualquier URL base compatible con OpenAI",
  customApiKeyLabel: "API key",
  customApiKeyHint:
    "Obligatoria para APIs remotas. Déjala en blanco para localhost.",
  defaultModelHint:
    "Déjalo en blanco para usar el modelo predeterminado del servidor",
  missingApiKey: "Introduce una API key",
  missingServerUrl: "Introduce la URL del servidor",
  saveFailed: "No se pudo guardar la configuración",
  noKeyHint: "¿No tienes una clave? Consigue una aquí",
  continue: "Continuar",
  saving: "Guardando...",
  apiKeyLabel: "API key de {{provider}}",
  noApiKeyRequired:
    "{{provider}} no requiere API key. Hermes usará tu configuración local de CLI/OAuth.",
  localNoKeyNeeded: "No se necesita API key",
  localLlm: "LLM local",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  modelNamePlaceholder: "p. ej. llama-3.1-8b",
} as const;
