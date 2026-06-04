export default {
  title: "Kanban",
  subtitle:
    "Tablero multiagente persistente para tareas que el agente puede tomar y completar por su cuenta.",

  // Acciones del encabezado
  refresh: "Actualizar",
  refreshTooltip: "Recargar tableros y tareas desde el agente",
  dispatch: "Despachar",
  dispatchTooltip:
    "Ejecutar un pase del despachador — promover tareas listas y lanzar trabajadores",
  newTask: "Nueva tarea",
  newTaskTooltip: "Crear una nueva tarea en el tablero actual",
  newBoard: "Nuevo tablero",
  newBoardTooltip: "Crear un nuevo tablero Kanban",

  // Aviso de modo remoto no compatible
  remoteUnsupportedTitle:
    "Kanban requiere una instalación local de Hermes o modo túnel SSH.",
  remoteUnsupportedHint:
    "El modo remoto simple (HTTP + clave API) aún no expone la API de Kanban. Cambia al modo local o túnel SSH en Configuración para gestionar el tablero.",

  // Estados de columna / tarea
  status: {
    triage: "Triage",
    todo: "Por hacer",
    ready: "Listo",
    running: "En curso",
    blocked: "Bloqueado",
    done: "Hecho",
  },

  // Tooltips de acciones de tarjeta
  cardSpecify: "Especificar (expandir spec → por hacer)",
  cardMarkDone: "Marcar como hecho",
  cardReclaim: "Recuperar trabajador",
  cardUnblock: "Desbloquear",
  cardBlock: "Bloquear",
  cardArchive: "Archivar",

  // Modal de crear tarea
  createTitle: "Nueva tarea Kanban",
  fieldTitle: "Título",
  titlePlaceholder: "¿Qué hay que hacer?",
  fieldBody: "Descripción (opcional)",
  bodyPlaceholder: "Contexto, criterios de aceptación, enlaces…",
  fieldAssignee: "Perfil asignado",
  assigneeNone: "— Triage (sin asignado)",
  fieldPriority: "Prioridad",
  priorityNormal: "Normal (0)",
  priorityLow: "Baja (P2)",
  priorityHigh: "Alta (P1)",
  priorityUrgent: "Urgente (P0)",
  fieldWorkspace: "Espacio de trabajo",
  workspaceScratch: "Temporal (directorio temp)",
  workspaceWorktree: "Worktree (repositorio actual)",
  workspaceChoose: "Elegir carpeta…",
  workspaceNoFolder: "No se seleccionó ninguna carpeta",
  browse: "Examinar…",
  triageCheckbox:
    "Poner en triage (un especificador expande el spec antes de promover a por hacer)",
  create: "Crear tarea",
  creating: "Creando…",

  // Modal de nuevo tablero
  newBoardTitle: "Nuevo tablero",
  fieldSlug: "Slug",
  slugPlaceholder: "kebab-case, ej. servidor-atm10",
  fieldDisplayName: "Nombre para mostrar (opcional)",
  displayNamePlaceholder: "Servidor ATM10",
  createBoard: "Crear tablero",

  // Modal de detalle de tarea
  detailFallbackTitle: "Tarea",
  detailBody: "Descripción",
  detailSummary: "Resumen de la última ejecución",
  detailResult: "Resultado",
  detailComments: "Comentarios ({{count}})",
  detailEvents: "Eventos ({{count}})",
  commentAnon: "anónimo",

  // Confirmaciones
  blockReasonPrompt: "¿Motivo del bloqueo?",
  confirmMarkDone: '¿Marcar "{{title}}" como hecho?',
  confirmArchive: '¿Archivar "{{title}}"?',

  // Errores
  moveNotAllowed:
    "No se puede mover {{from}} → {{to}} desde el escritorio. Usa el agente o el CLI.",
  errLoadBoards: "Error al cargar los tableros",
  errLoadTasks: "Error al cargar las tareas",
  errMoveTask: "Error al mover la tarea",
  errPickFolder: "Selecciona primero una carpeta de trabajo.",
  errCreateTask: "Error al crear la tarea",
  errSwitchBoard: "Error al cambiar de tablero",
  errCreateBoard: "Error al crear el tablero",
  errSpecify: "Error al especificar la tarea",
  errArchive: "Error al archivar la tarea",
  errReclaim: "Error al recuperar",
  errDispatch: "Error en el despacho",
} as const;
