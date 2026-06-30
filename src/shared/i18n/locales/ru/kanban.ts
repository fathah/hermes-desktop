export default {
  title: "Kanban",
  subtitle:
    "Устойчивая мультиагентная доска для задач, которые агент может брать и завершать самостоятельно.",

  // Header actions
  refresh: "Обновить",
  refreshTooltip: "Перезагрузить доски и задачи от агента",
  dispatch: "Dispatch",
  dispatchTooltip:
    "Запустить один проход диспетчера — продвинуть готовые задачи и запустить workers",
  newTask: "Новая задача",
  newTaskTooltip: "Создать новую задачу на текущей доске",
  newBoard: "Новая доска",
  newBoardTooltip: "Создать новую kanban-доску",
  showArchived: "Показать архивные",
  hideArchived: "Скрыть архивные",
  archivedTooltip: "Показать/скрыть колонку архива",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "Kanban требует локальной установки Hermes или режима SSH-туннеля.",
  remoteUnsupportedHint:
    "Обычный удаленный режим (HTTP + API key) пока не открывает kanban API. Переключитесь на локальный режим или SSH-туннель в настройках, чтобы управлять доской.",

  // Column / task statuses
  status: {
    triage: "Triage",
    todo: "To-do",
    scheduled: "Запланировано",
    ready: "Готово",
    running: "В работе",
    blocked: "Заблокировано",
    review: "На проверке",
    done: "Завершено",
    archived: "Архив",
  },

  // Card action tooltips
  cardSpecify: "Уточнить (развернуть постановку → to-do)",
  cardMarkDone: "Отметить выполненной",
  cardReclaim: "Освободить worker",
  cardUnblock: "Разблокировать",
  cardBlock: "Заблокировать",
  cardArchive: "Архивировать",

  // Create-task modal
  createTitle: "Новая kanban-задача",
  fieldTitle: "Заголовок",
  titlePlaceholder: "Что нужно сделать?",
  fieldBody: "Описание (необязательно)",
  bodyPlaceholder: "Контекст, критерии приемки, ссылки...",
  fieldAssignee: "Профиль исполнителя",
  assigneeNone: "— Triage (без исполнителя)",
  fieldPriority: "Приоритет",
  priorityNormal: "Обычный (0)",
  priorityLow: "Низкий (P2)",
  priorityHigh: "Высокий (P1)",
  priorityUrgent: "Срочный (P0)",
  fieldWorkspace: "Рабочая область",
  workspaceScratch: "Временное хранилище (scratch)",
  workspaceWorktree: "Worktree (текущий репозиторий)",
  workspaceChoose: "Выбрать папку...",
  workspaceNoFolder: "Папка не выбрана",
  browse: "Обзор...",
  triageCheckbox:
    "Оставить в triage (specifier развернет spec перед переводом в to-do)",
  create: "Создать задачу",
  creating: "Создание...",

  // New-board modal
  newBoardTitle: "Новая доска",
  fieldSlug: "Slug",
  slugPlaceholder: "kebab-case, например atm10-server",
  fieldDisplayName: "Отображаемое имя (необязательно)",
  displayNamePlaceholder: "ATM10 Server",
  createBoard: "Создать доску",

  // Task-detail modal
  detailFallbackTitle: "Задача",
  detailBody: "Описание",
  detailSummary: "Последняя сводка запуска",
  detailResult: "Результат",
  detailComments: "Комментарии ({{count}})",
  detailEvents: "События ({{count}})",
  commentAnon: "anon",

  // Prompts / confirmations
  blockReasonPrompt: "Причина блокировки?",
  confirmMarkDone: 'Отметить "{{title}}" выполненной?',
  confirmArchive: 'Архивировать "{{title}}"?',

  // Errors
  moveNotAllowed:
    "Нельзя переместить {{from}} → {{to}} из desktop-приложения. Используйте агента или CLI.",
  errLoadBoards: "Не удалось загрузить доски",
  errLoadTasks: "Не удалось загрузить задачи",
  errMoveTask: "Не удалось переместить задачу",
  errPickFolder: "Сначала выберите папку рабочей области.",
  errCreateTask: "Не удалось создать задачу",
  errSwitchBoard: "Не удалось переключить доску",
  errCreateBoard: "Не удалось создать доску",
  errSpecify: "Не удалось уточнить задачу",
  errArchive: "Не удалось архивировать задачу",
  errReclaim: "Не удалось вернуть",
  errDispatch: "Dispatch не удался",

  // Tooltips & buttons
  hqBoardTooltip: "Доска штаб-квартиры Claw3D (зеркало только для чтения)",
  dismissError: "Скрыть ошибку",
  closeTaskDetails: "Закрыть детали задачи",
} as const;
