export default {
  title: "Канбан",
  subtitle:
    "Надзейная шматагентная дошка для задач, якія агент можа ўзяць і выканаць самастойна.",

  // Header actions
  refresh: "Абнавіць",
  refreshTooltip: "Перазагрузіць дошкі і задачы ад агента",
  dispatch: "Запусціць дыспетчар",
  dispatchTooltip:
    "Выканаць адзін праход дыспетчара — прасунуць гатовыя задачы і запусціць выканаўцаў",
  newTask: "Новая задача",
  newTaskTooltip: "Стварыць новую задачу на бягучай дошцы",
  newBoard: "Новая дошка",
  newBoardTooltip: "Стварыць новую дошку Канбан",
  showArchived: "Паказаць архіўныя",
  hideArchived: "Схаваць архіўныя",
  archivedTooltip: "Паказаць або схаваць слупок архіва",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "Канбан патрабуе лакальнай усталёўкі Hermes або рэжыму SSH-тунелю.",
  remoteUnsupportedHint:
    "Звычайны аддалены рэжым (HTTP + API-ключ) пакуль не дае доступу да API Канбана. Каб кіраваць дошкай, пераключыцеся ў наладах на лакальны рэжым або рэжым SSH-тунелю.",

  // Column / task statuses
  status: {
    triage: "Разгляд",
    todo: "Да выканання",
    scheduled: "Запланаваныя",
    ready: "Гатовыя",
    running: "Выконваюцца",
    blocked: "Заблакаваныя",
    review: "Праверка",
    done: "Выкананыя",
    archived: "Архіўныя",
  },

  // Card action tooltips
  cardSpecify: "Удакладніць (пашырыць спецыфікацыю → да выканання)",
  cardMarkDone: "Пазначыць выкананай",
  cardReclaim: "Забраць задачу ў выканаўцы",
  cardUnblock: "Зняць блакаванне",
  cardBlock: "Заблакаваць",
  cardArchive: "Адправіць у архіў",

  // Create-task modal
  createTitle: "Новая задача Канбан",
  fieldTitle: "Назва",
  titlePlaceholder: "Што трэба зрабіць?",
  fieldBody: "Апісанне (неабавязкова)",
  bodyPlaceholder: "Кантэкст, крытэрыі прыёмкі, спасылкі…",
  fieldAssignee: "Профіль выканаўцы",
  assigneeNone: "— Разгляд (без выканаўцы)",
  fieldPriority: "Прыярытэт",
  priorityNormal: "Звычайны (0)",
  priorityLow: "Нізкі (P2)",
  priorityHigh: "Высокі (P1)",
  priorityUrgent: "Тэрміновы (P0)",
  fieldWorkspace: "Працоўная прастора",
  workspaceScratch: "Scratch (часовы каталог)",
  workspaceWorktree: "Worktree (бягучы рэпазіторый)",
  workspaceChoose: "Выбраць папку…",
  workspaceNoFolder: "Папка не выбрана",
  workspaceServerPath: "Абсалютны шлях на серверы",
  browse: "Праглядзець…",
  triageCheckbox:
    "Пакінуць у разглядзе (удакладняльнік пашырае спецыфікацыю перад пераносам у «Да выканання»)",
  create: "Стварыць задачу",
  creating: "Стварэнне…",

  // New-board modal
  newBoardTitle: "Новая дошка",
  fieldSlug: "Кароткая назва (slug)",
  slugPlaceholder: "kebab-case, напр. atm10-server",
  fieldDisplayName: "Бачная назва (неабавязкова)",
  displayNamePlaceholder: "ATM10 Server",
  createBoard: "Стварыць дошку",

  // Task-detail modal
  detailFallbackTitle: "Задача",
  detailBody: "Апісанне",
  detailSummary: "Зводка апошняга запуску",
  detailResult: "Вынік",
  detailComments: "Каментары ({{count}})",
  detailEvents: "Падзеі ({{count}})",
  commentAnon: "ананім",

  // Prompts / confirmations
  blockReasonPrompt: "Прычына блакавання?",
  confirmMarkDone: "Пазначыць «{{title}}» выкананай?",
  confirmArchive: "Адправіць «{{title}}» у архіў?",

  // Errors
  moveNotAllowed:
    "Нельга перамясціць {{from}} → {{to}} з настольнай версіі. Скарыстайцеся агентам або CLI.",
  errLoadBoards: "Не ўдалося загрузіць дошкі",
  errLoadTasks: "Не ўдалося загрузіць задачы",
  errMoveTask: "Не ўдалося перамясціць задачу",
  errPickFolder: "Спачатку выберыце папку працоўнай прасторы.",
  errCreateTask: "Не ўдалося стварыць задачу",
  errSwitchBoard: "Не ўдалося пераключыць дошку",
  errCreateBoard: "Не ўдалося стварыць дошку",
  errSpecify: "Не ўдалося ўдакладніць задачу",
  errArchive: "Не ўдалося адправіць задачу ў архіў",
  errReclaim: "Не ўдалося забраць задачу ў выканаўцы",
  errDispatch: "Не ўдалося запусціць дыспетчар",

  // Tooltips & buttons
  hqBoardTooltip: "Дошка штаб-кватэры Claw3D (люстраная копія толькі для чытання)",
  dismissError: "Схаваць памылку",
  closeTaskDetails: "Закрыць дэталі задачы",
} as const;
