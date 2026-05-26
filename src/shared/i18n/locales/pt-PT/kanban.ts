export default {
  title: "Kanban",
  subtitle:
    "Quadro multi-agente durável para tarefas que o agente pode escolher e concluir autonomamente.",

  // Header actions
  refresh: "Actualizar",
  refreshTooltip: "Recarregar quadros e tarefas a partir do agente",
  dispatch: "Despachar",
  dispatchTooltip:
    "Executar uma passagem do despachante — promover tarefas prontas e iniciar trabalhadores",
  newTask: "Nova tarefa",
  newTaskTooltip: "Criar uma nova tarefa no quadro actual",
  newBoard: "Novo quadro",
  newBoardTooltip: "Criar um novo quadro kanban",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "O Kanban requer uma instalação local do Hermes ou o modo de túnel SSH.",
  remoteUnsupportedHint:
    "O modo remoto simples (HTTP + chave de API) ainda não expõe a API do kanban. Mude para o modo local ou de túnel SSH nas Definições para gerir o quadro.",

  // Column / task statuses
  status: {
    triage: "Triagem",
    todo: "Por fazer",
    ready: "Pronto",
    running: "Em execução",
    blocked: "Bloqueado",
    done: "Concluído",
  },

  // Card action tooltips
  cardSpecify: "Especificar (expandir especificação → por fazer)",
  cardMarkDone: "Marcar como concluída",
  cardReclaim: "Recuperar worker",
  cardUnblock: "Desbloquear",
  cardBlock: "Bloquear",
  cardArchive: "Arquivar",

  // Create-task modal
  createTitle: "Nova tarefa kanban",
  fieldTitle: "Título",
  titlePlaceholder: "O que precisa de ser feito?",
  fieldBody: "Corpo (opcional)",
  bodyPlaceholder: "Contexto, critérios de aceitação, ligações…",
  fieldAssignee: "Perfil responsável",
  assigneeNone: "— Triagem (sem responsável)",
  fieldPriority: "Prioridade",
  priorityNormal: "Normal (0)",
  priorityLow: "Baixa (P2)",
  priorityHigh: "Alta (P1)",
  priorityUrgent: "Urgente (P0)",
  fieldWorkspace: "Espaço de trabalho",
  workspaceScratch: "Temporário (pasta temp)",
  workspaceWorktree: "Worktree (repositório actual)",
  workspaceChoose: "Escolher pasta…",
  workspaceNoFolder: "Nenhuma pasta seleccionada",
  browse: "navegar…",
  triageCheckbox:
    "Estacionar em triagem (um especificador expande a especificação antes de a promover para «Por fazer»)",
  create: "Criar tarefa",
  creating: "A criar…",

  // New-board modal
  newBoardTitle: "Novo quadro",
  fieldSlug: "Slug",
  slugPlaceholder: "kebab-case, ex.: atm10-server",
  fieldDisplayName: "Nome (opcional)",
  displayNamePlaceholder: "ATM10 Server",
  createBoard: "Criar quadro",

  // Task-detail modal
  detailFallbackTitle: "Tarefa",
  detailBody: "Corpo",
  detailSummary: "Resumo da última execução",
  detailResult: "Resultado",
  detailComments: "Comentários ({{count}})",
  detailEvents: "Eventos ({{count}})",
  commentAnon: "anónimo",

  // Prompts / confirmations
  blockReasonPrompt: "Motivo do bloqueio?",
  confirmMarkDone: 'Marcar "{{title}}" como concluída?',
  confirmArchive: 'Arquivar "{{title}}"?',

  // Errors
  moveNotAllowed:
    "Não é possível mover {{from}} → {{to}} a partir da aplicação. Use o agente ou a CLI.",
  errLoadBoards: "Falha ao carregar os quadros",
  errLoadTasks: "Falha ao carregar as tarefas",
  errMoveTask: "Falha ao mover a tarefa",
  errPickFolder: "Escolha primeiro uma pasta de espaço de trabalho.",
  errCreateTask: "Falha ao criar a tarefa",
  errSwitchBoard: "Falha ao mudar de quadro",
  errCreateBoard: "Falha ao criar o quadro",
  errSpecify: "Falha ao especificar a tarefa",
  errArchive: "Falha ao arquivar a tarefa",
  errReclaim: "Falha ao recuperar",
  errDispatch: "Falha no despacho",
} as const;
