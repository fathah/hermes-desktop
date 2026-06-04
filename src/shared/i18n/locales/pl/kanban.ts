export default {
  title: "Kanban",
  subtitle:
    "Trwała tablica multi-agentowa dla zadań, które agent może sam podjąć i dokończyć.",

  refresh: "Odśwież",
  refreshTooltip: "Przeładuj tablice i zadania z agenta",
  dispatch: "Dispatch",
  dispatchTooltip:
    "Uruchom jeden przebieg dispatchera — promuj gotowe zadania i uruchom workerów",
  newTask: "Nowe zadanie",
  newTaskTooltip: "Utwórz nowe zadanie na bieżącej tablicy",
  newBoard: "Nowa tablica",
  newBoardTooltip: "Utwórz nową tablicę kanban",

  remoteUnsupportedTitle:
    "Kanban wymaga lokalnej instalacji Hermes albo trybu tunelu SSH.",
  remoteUnsupportedHint:
    "Zwykły tryb zdalny (HTTP + klucz API) nie udostępnia jeszcze API kanban. Przełącz na tryb lokalny lub tunel SSH w Ustawieniach, aby zarządzać tablicą.",

  status: {
    triage: "Triage",
    todo: "Do zrobienia",
    ready: "Gotowe",
    running: "W toku",
    blocked: "Zablokowane",
    done: "Ukończone",
  },

  cardSpecify: "Doprecyzuj (rozwiń spec → do zrobienia)",
  cardMarkDone: "Oznacz jako ukończone",
  cardReclaim: "Odzyskaj workera",
  cardUnblock: "Odblokuj",
  cardBlock: "Zablokuj",
  cardArchive: "Archiwizuj",

  createTitle: "Nowe zadanie kanban",
  fieldTitle: "Tytuł",
  titlePlaceholder: "Co trzeba zrobić?",
  fieldBody: "Treść (opcjonalnie)",
  bodyPlaceholder: "Kontekst, kryteria akceptacji, linki…",
  fieldAssignee: "Profil wykonawcy",
  assigneeNone: "— Triage (bez wykonawcy)",
  fieldPriority: "Priorytet",
  priorityNormal: "Normalny (0)",
  priorityLow: "Niski (P2)",
  priorityHigh: "Wysoki (P1)",
  priorityUrgent: "Pilny (P0)",
  fieldWorkspace: "Workspace",
  workspaceScratch: "Scratch (katalog tymczasowy)",
  workspaceWorktree: "Worktree (bieżące repo)",
  workspaceChoose: "Wybierz folder…",
  workspaceNoFolder: "Nie wybrano folderu",
  browse: "Przeglądaj…",
  triageCheckbox:
    "Zostaw w triage (specifier rozwinie specyfikację przed promocją do do zrobienia)",
  create: "Utwórz zadanie",
  creating: "Tworzenie…",

  newBoardTitle: "Nowa tablica",
  fieldSlug: "Slug",
  slugPlaceholder: "kebab-case, np. atm10-server",
  fieldDisplayName: "Nazwa wyświetlana (opcjonalnie)",
  displayNamePlaceholder: "Serwer ATM10",
  createBoard: "Utwórz tablicę",

  detailFallbackTitle: "Zadanie",
  detailBody: "Treść",
  detailSummary: "Najnowsze podsumowanie uruchomienia",
  detailResult: "Wynik",
  detailComments: "Komentarze ({{count}})",
  detailEvents: "Zdarzenia ({{count}})",
  commentAnon: "anon",

  blockReasonPrompt: "Powód blokady?",
  confirmMarkDone: 'Oznaczyć "{{title}}" jako ukończone?',
  confirmArchive: 'Zarchiwizować "{{title}}"?',

  moveNotAllowed:
    "Nie można przenieść {{from}} → {{to}} z desktopu. Użyj agenta albo CLI.",
  errLoadBoards: "Nie udało się wczytać tablic",
  errLoadTasks: "Nie udało się wczytać zadań",
  errMoveTask: "Nie udało się przenieść zadania",
  errPickFolder: "Najpierw wybierz folder workspace.",
  errCreateTask: "Nie udało się utworzyć zadania",
  errSwitchBoard: "Nie udało się przełączyć tablicy",
  errCreateBoard: "Nie udało się utworzyć tablicy",
  errSpecify: "Nie udało się doprecyzować zadania",
  errArchive: "Nie udało się zarchiwizować zadania",
  errReclaim: "Nie udało się odzyskać",
  errDispatch: "Dispatch nie powiódł się",
} as const;
