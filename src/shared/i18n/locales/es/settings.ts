export default {
  title: "Configuración",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Apariencia",
    privacy: "Privacidad",
    credentialPool: "Grupo de credenciales",
  },
  analytics: {
    label: "Enviar analíticas de uso anónimas",
    hint: "Ayuda a mejorar Hermes enviando datos de uso anónimos y agregados a la instancia PostHog del proyecto (alojada en la UE). Puedes desactivarlo en cualquier momento.",
    disclosure: {
      uuid: "Un identificador aleatorio por instalación almacenado únicamente en este dispositivo (sin nombre, correo electrónico ni datos de cuenta).",
      platform:
        "Tu sistema operativo, versión de Electron y versión de Node.js.",
      navigation:
        "Qué pantallas visitas dentro de la aplicación (p. ej. Chat, Sesiones, Configuración). No se recopila contenido de chats, prompts, respuestas del modelo ni contenido de archivos.",
      endpoint:
        "Los datos se envían a eu.i.posthog.com (nube europea de PostHog). Las grabaciones de sesión y la captura automática de páginas vistas están desactivadas.",
      notCollected:
        "Nunca se recopila: mensajes de chat, rutas de archivos, claves de API, configuración del modelo, credenciales de cuenta.",
    },
  },
  theme: {
    label: "Tema",
    system: "Sistema",
    light: "Claro",
    dark: "Oscuro",
  },
  language: {
    label: "Idioma",
    english: "English",
    indonesian: "Indonesio",
    japanese: "日本語",
    spanish: "Español",
    chinese: "中文",
    portuguese: "Português",
    hint: "Elige el idioma de la interfaz",
  },
  notDetected: "No detectado",
  updatedSuccessfully: "¡Actualizado correctamente!",
  updateSuccess: "Hermes se actualizó correctamente.",
  updateFailed: "La actualización falló.",
  version: "v{{version}}",
  proxyPlaceholder: "p. ej. socks5://127.0.0.1:1080 o http://proxy:8080",
  modelNamePlaceholder: "p. ej. anthropic/claude-opus-4.6",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  networkSection: "Red",
  forceIpv4: "Forzar IPv4",
  forceIpv4Hint:
    "Desactiva IPv6 para corregir problemas de tiempo de espera de conexión en algunas redes",
  httpProxy: "Proxy HTTP",
  httpProxyHint:
    "Proxy SOCKS o HTTP para todas las conexiones salientes (déjalo en blanco para detección automática)",
  saved: "Guardado",
  providerHint:
    "Selecciona un proveedor de inferencia o detecta uno automáticamente según la API key",
  customProviderHint:
    "Usa cualquier API compatible con OpenAI (LM Studio, Ollama, vLLM, etc.)",
  modelHint:
    "Nombre del modelo predeterminado (déjalo en blanco para usar el valor predeterminado del proveedor)",
  refreshModels: "Actualizar lista de modelos",
  discoveringModels: "Cargando modelos disponibles…",
  discoveredCount:
    "{{count}} modelos disponibles — empieza a escribir para filtrar",
  discoveryNoKey:
    "Define la API key de este proveedor en .env para cargar la lista de modelos disponibles",
  discoveryError:
    "No se pudo acceder a la lista de modelos del proveedor — aún puedes escribir un nombre de modelo",
  customBaseUrlHint: "Endpoint de API compatible con OpenAI",
  poolHint:
    "Agrega varias API keys para el mismo proveedor para la rotación automática y el equilibrio de carga. Hermes alternará entre ellas.",
  add: "Agregar",
  remove: "Quitar",
  keyLabel: "Clave",
  empty: "(vacío)",
  dataSection: "Datos",
  dataHint:
    "Exporta o importa tu configuración de Hermes, sesiones, habilidades y memoria.",
  backingUp: "Creando copia de seguridad...",
  exportBackup: "Exportar copia de seguridad",
  importing: "Importando...",
  importBackup: "Importar copia de seguridad",
  logsSection: "Registros",
  refresh: "Actualizar",
  emptyLog: "(vacío)",
  updating: "Actualizando...",
  updateEngine: "Actualizar motor",
  latestVersion: "Ya está actualizado",
  runningDiagnosis: "Ejecutando diagnóstico...",
  runDiagnosis: "Ejecutar diagnóstico",
  running: "Ejecutando...",
  debugDump: "Volcado de depuración",
  migrationDetected: "Se detectó una instalación de OpenClaw",
  migrationDesc:
    "Se encontró OpenClaw en <code>{{path}}</code>. Puedes migrar tu configuración, API keys, sesiones y habilidades a Hermes.",
  migrationDismiss: "No volver a mostrar",
  migrating: "Migrando...",
  migrateToHermes: "Migrar a Hermes",
  skip: "Omitir",
  appearanceHint: "Elige la apariencia de interfaz que prefieras",
  apiKeyPlaceholder: "API key",
  labelPlaceholder: "Etiqueta ({{optional}})",
  connectionSection: "Conexión",
  modeLocal: "Local",
  modeRemote: "Remoto",
  modeLocalHint: "Usando Hermes instalado en este dispositivo",
  modeRemoteHint:
    "Conectarse a un servidor de API de Hermes en tu red o en la nube",
  remoteUrl: "URL remota",
  remoteUrlHint:
    "La URL del servidor de API de Hermes (debe exponer /health y /v1/chat/completions)",
  remoteApiKey: "API key",
  remoteApiKeyHint:
    "Coincide con API_SERVER_KEY en el host remoto. Déjalo vacío si el servidor acepta solicitudes no autenticadas.",
  testingConnection: "Probando...",
  testConnection: "Probar conexión",
  save: "Guardar",
  serverConfigTitle: "Configuración del servidor",
  serverConfigHint:
    "Estás conectado a un servidor remoto de Hermes. La selección de modelos, las API keys de proveedores y las credenciales se administran en <code>~/.hermes/.env</code> y <code>config.yaml</code> del servidor. Edítalos en el host (por ejemplo, <code>docker exec -it hermes vi /opt/data/.env</code>) y reinicia el contenedor.",
  connectionMode: "Modo",
  switchedToLocal: "Se cambió al modo local",
} as const;
