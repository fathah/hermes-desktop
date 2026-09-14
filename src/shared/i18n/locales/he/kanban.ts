export default {
  title: "קנבן",
  subtitle: "לוח רב-סוכני עמיד למשימות שהסוכן יכול לקחת ולסיים בכוחות עצמו.",

  // Header actions
  refresh: "רענון",
  refreshTooltip: "טעינה מחדש של הלוחות והמשימות מהסוכן",
  dispatch: "שיגור",
  dispatchTooltip: "הרצת מעבר שיגור אחד - קידום משימות מוכנות ויצירת עובדים",
  newTask: "משימה חדשה",
  newTaskTooltip: "יצירת משימה חדשה בלוח הנוכחי",
  newBoard: "לוח חדש",
  newBoardTooltip: "יצירת לוח קנבן חדש",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle: "קנבן דורש התקנת Hermes מקומית או מצב מנהרת SSH.",
  remoteUnsupportedHint:
    "מצב מרוחק רגיל ‏(HTTP + מפתח API) עדיין אינו חושף את ה-API של הקנבן. עברו למצב מקומי או למצב מנהרת SSH בהגדרות כדי לנהל את הלוח.",

  // Column / task statuses
  status: {
    triage: "מיון",
    todo: "לביצוע",
    ready: "מוכן",
    running: "בריצה",
    blocked: "חסום",
    done: "הושלם",
  },

  // Card action tooltips
  cardSpecify: "פירוט (הרחבת מפרט ← לביצוע)",
  cardMarkDone: "סימון כהושלם",
  cardReclaim: "החזרת עובד",
  cardUnblock: "ביטול חסימה",
  cardBlock: "חסימה",
  cardArchive: "העברה לארכיון",

  // Create-task modal
  createTitle: "משימת קנבן חדשה",
  fieldTitle: "כותרת",
  titlePlaceholder: "מה צריך לעשות?",
  fieldBody: "תוכן (אופציונלי)",
  bodyPlaceholder: "הקשר, קריטריוני קבלה, קישורים…",
  fieldAssignee: "פרופיל אחראי",
  assigneeNone: "- מיון (ללא אחראי)",
  fieldPriority: "עדיפות",
  priorityNormal: "רגילה (0)",
  priorityLow: "נמוכה (P2)",
  priorityHigh: "גבוהה (P1)",
  priorityUrgent: "דחופה (P0)",
  fieldWorkspace: "מרחב עבודה",
  workspaceScratch: "זמני (תיקיית temp)",
  workspaceWorktree: "Worktree (המאגר הנוכחי)",
  workspaceChoose: "בחירת תיקייה…",
  workspaceNoFolder: "לא נבחרה תיקייה",
  browse: "עיון…",
  triageCheckbox: "החנייה במיון (מפרֵט מרחיב את המפרט לפני קידום לביצוע)",
  create: "יצירת משימה",
  creating: "יוצר…",

  // New-board modal
  newBoardTitle: "לוח חדש",
  fieldSlug: "מזהה (Slug)",
  slugPlaceholder: "kebab-case, לדוגמה: atm10-server",
  fieldDisplayName: "שם תצוגה (אופציונלי)",
  displayNamePlaceholder: "ATM10 Server",
  createBoard: "יצירת לוח",

  // Task-detail modal
  detailFallbackTitle: "משימה",
  detailBody: "תוכן",
  detailSummary: "סיכום ההרצה האחרונה",
  detailResult: "תוצאה",
  detailComments: "תגובות ({{count}})",
  detailEvents: "אירועים ({{count}})",
  commentAnon: "אנונימי",

  // Prompts / confirmations
  blockReasonPrompt: "סיבת החסימה?",
  confirmMarkDone: 'לסמן את "{{title}}" כהושלם?',
  confirmArchive: 'להעביר את "{{title}}" לארכיון?',

  // Errors
  moveNotAllowed:
    "לא ניתן להעביר {{from}} ← {{to}} משולחן העבודה. השתמשו בסוכן או ב-CLI.",
  errLoadBoards: "טעינת הלוחות נכשלה",
  errLoadTasks: "טעינת המשימות נכשלה",
  errMoveTask: "העברת המשימה נכשלה",
  errPickFolder: "בחרו תחילה תיקיית מרחב עבודה.",
  errCreateTask: "יצירת המשימה נכשלה",
  errSwitchBoard: "החלפת הלוח נכשלה",
  errCreateBoard: "יצירת הלוח נכשלה",
  errSpecify: "פירוט המשימה נכשל",
  errArchive: "העברת המשימה לארכיון נכשלה",
  errReclaim: "ההחזרה נכשלה",
  errDispatch: "השיגור נכשל",

  hqBoardTooltip: "לוח המטה של Claw3D (תצוגת מראה לקריאה בלבד)",
  dismissError: "סגירת השגיאה",
  closeTaskDetails: "סגירת פרטי המשימה",
} as const;
