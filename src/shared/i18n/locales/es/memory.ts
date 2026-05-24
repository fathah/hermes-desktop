export default {
  title: "Memoria",
  subtitle: "Lo que Hermes recuerda sobre ti y tu entorno entre sesiones.",
  sessions: "Sesiones",
  messages: "Mensajes",
  memories: "Recuerdos",
  providersTitle: "Proveedores",
  agentMemory: "Memoria del agente",
  userProfile: "Perfil del usuario",
  entries: "{{count}} entradas",
  addMemory: "Agregar recuerdo",
  addFailed: "No se pudo agregar la entrada",
  updateFailed: "No se pudo actualizar la entrada",
  saveFailed: "No se pudo guardar",
  entriesPlaceholder:
    "p. ej. El usuario prefiere TypeScript en lugar de JavaScript. Usa siempre el modo estricto.",
  userProfilePlaceholder:
    "p. ej. Nombre: Alex. Desarrollador sénior. Prefiere respuestas concisas. Usa macOS con zsh. Zona horaria: PST.",
  noProvidersFound:
    "No se encontraron proveedores de memoria en esta instalación.",
  openProviderWebsite: "Abrir el sitio web del proveedor",
  noMemoriesYet:
    "Todavía no hay recuerdos. Hermes guardará los datos importantes mientras chateas.",
  noMemoryEntries: "Todavía no hay entradas de memoria.",
  noToolsetsFound: "No se encontraron conjuntos de herramientas.",
  addManuallyHint:
    "También puedes agregar recuerdos manualmente con el botón de arriba.",
  userProfileHint:
    "Cuéntale a Hermes sobre ti: nombre, rol, preferencias y estilo de comunicación.",
  providersHint:
    "Los proveedores de memoria conectables ofrecen a Hermes memoria avanzada a largo plazo. La memoria integrada (arriba) siempre está activa junto con el proveedor seleccionado.",
  providersHintActive: "Activo: <strong>{{provider}}</strong>",
  providersHintInactive:
    "No hay ningún proveedor externo activo — usando solo la memoria integrada.",
  enterEnvKey: "Introduce {{key}}",
  chars: "{{count}} caracteres",
  cancel: "Cancelar",
  save: "Guardar",
  edit: "Editar",
  deleteConfirm: "¿Eliminar?",
  yes: "Sí",
  no: "No",
  saveProfile: "Guardar perfil",
  active: "Activo",
  deactivate: "Desactivar",
  activating: "Activando...",
  activate: "Activar",
  providers: {
    honcho:
      "Modelado de usuarios nativo para IA entre sesiones con preguntas y respuestas dialécticas y búsqueda semántica",
    hindsight:
      "Memoria a largo plazo con grafo de conocimiento y recuperación con múltiples estrategias",
    mem0: "Extracción de hechos con LLM en el servidor, con búsqueda semántica y eliminación automática de duplicados",
    retaindb:
      "API de memoria en la nube con búsqueda híbrida y 7 tipos de memoria",
    supermemory:
      "Memoria semántica a largo plazo con recuperación de perfiles y extracción de entidades",
    holographic:
      "Almacén local de hechos en SQLite con búsqueda FTS5 y puntuación de confianza (no requiere API key)",
    openviking:
      "Memoria gestionada por sesiones con recuperación por niveles y exploración del conocimiento",
    byterover:
      "Árbol de conocimiento persistente con recuperación por niveles mediante la CLI de brv",
  },
} as const;
