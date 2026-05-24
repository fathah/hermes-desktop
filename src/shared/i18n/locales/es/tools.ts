export default {
  title: "Herramientas",
  subtitle:
    "Activa o desactiva los conjuntos de herramientas que tu agente puede usar durante las conversaciones",
  web: {
    label: "Búsqueda web",
    description: "Busca en la web y extrae contenido de URLs",
  },
  browser: {
    label: "Navegador",
    description: "Navega, haz clic, escribe e interactúa con páginas web",
  },
  terminal: {
    label: "Terminal",
    description: "Ejecuta comandos y scripts de shell",
  },
  file: {
    label: "Operaciones con archivos",
    description: "Lee, escribe, busca y administra archivos",
  },
  code_execution: {
    label: "Ejecución de código",
    description: "Ejecuta código de Python y shell directamente",
  },
  vision: {
    label: "Visión",
    description: "Analiza imágenes y contenido visual",
  },
  image_gen: {
    label: "Generación de imágenes",
    description: "Genera imágenes con DALL-E y otros modelos",
  },
  tts: {
    label: "Texto a voz",
    description: "Convierte texto en audio hablado",
  },
  skills: {
    label: "Habilidades",
    description: "Crea, administra y ejecuta habilidades reutilizables",
  },
  memory: {
    label: "Memoria",
    description: "Almacena y recupera conocimiento persistente",
  },
  session_search: {
    label: "Búsqueda de sesiones",
    description: "Busca en conversaciones anteriores",
  },
  clarify: {
    label: "Preguntas de aclaración",
    description: "Pide aclaraciones al usuario cuando sea necesario",
  },
  delegation: {
    label: "Delegación",
    description: "Lanza subagentes para tareas en paralelo",
  },
  cronjob: {
    label: "Tareas cron",
    description: "Crea y administra tareas programadas",
  },
  moa: {
    label: "Mezcla de agentes",
    description: "Coordina varios modelos de IA en conjunto",
  },
  todo: {
    label: "Planificación de tareas",
    description: "Crea y administra listas de tareas para trabajos complejos",
  },
  mcpServers: "Servidores MCP",
  mcpDescription:
    "Servidores Model Context Protocol configurados en config.yaml. Adminístralos con <code>hermes mcp add/remove</code> en la terminal.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "desactivado",
} as const;
