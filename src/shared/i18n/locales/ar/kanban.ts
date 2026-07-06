export default {
  title: "كانبان",
  subtitle:
    "لوحة متعددة الوكلاء دائمة للمهام التي يمكن للوكيل التقاطها وإكمالها بنفسه.",

  // Header actions
  refresh: "تحديث",
  refreshTooltip: "إعادة تحميل اللوحات والمهام من الوكيل",
  dispatch: "توزيع",
  dispatchTooltip:
    "تشغيل تمريرة توزيع واحدة — ترقية المهام الجاهزة وتشغيل العمال",
  newTask: "مهمة جديدة",
  newTaskTooltip: "إنشاء مهمة جديدة على اللوحة الحالية",
  newBoard: "لوحة جديدة",
  newBoardTooltip: "إنشاء لوحة كانبان جديدة",
  showArchived: "إظهار المؤرشفة",
  hideArchived: "إخفاء المؤرشفة",
  archivedTooltip: "تبديل إظهار عمود المؤرشفة",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "يتطلب كانبان تثبيت Hermes محلي أو وضع نفق SSH.",
  remoteUnsupportedHint:
    "الوضع البعيد العادي (HTTP + مفتاح API) لا يعرض API كانبان بعد. انتقل إلى الوضع المحلي أو نفق SSH في الإعدادات لإدارة اللوحة.",

  // Column / task statuses
  status: {
    triage: "فرز",
    todo: "للتنفيذ",
    scheduled: "مجدول",
    ready: "جاهز",
    running: "قيد التنفيذ",
    blocked: "محظور",
    review: "مراجعة",
    done: "مكتمل",
    archived: "مؤرشف",
  },

  // Card action tooltips
  cardSpecify: "تحديد (توسيع المواصفات ← للتنفيذ)",
  cardMarkDone: "تعيين كمكتمل",
  cardReclaim: "استعادة العامل",
  cardUnblock: "إلغاء الحظر",
  cardBlock: "حظر",
  cardArchive: "أرشفة",

  // Create-task modal
  createTitle: "مهمة كانبان جديدة",
  fieldTitle: "العنوان",
  titlePlaceholder: "ما الذي يجب إنجازه؟",
  fieldBody: "الوصف (اختياري)",
  bodyPlaceholder: "سياق، معايير قبول، روابط...",
  fieldAssignee: "ملف العامل المعين",
  assigneeNone: "— فرز (بدون تعيين)",
  fieldPriority: "الأولوية",
  priorityNormal: "عادية (0)",
  priorityLow: "منخفضة (P2)",
  priorityHigh: "عالية (P1)",
  priorityUrgent: "عاجلة (P0)",
  fieldWorkspace: "مساحة العمل",
  workspaceScratch: "مؤقتة (مجلد مؤقت)",
  workspaceWorktree: "شجرة العمل (المستودع الحالي)",
  workspaceChoose: "اختيار مجلد...",
  workspaceNoFolder: "لم يتم اختيار مجلد",
  browse: "تصفح...",
  triageCheckbox:
    "وضع في الفرز (يقوم المحدد بتوسيع المواصفات قبل الترقية إلى للتنفيذ)",
  create: "إنشاء مهمة",
  creating: "جارٍ الإنشاء...",

  // New-board modal
  newBoardTitle: "لوحة جديدة",
  fieldSlug: "المعرف",
  slugPlaceholder: "kebab-case، مثال: atm10-server",
  fieldDisplayName: "اسم العرض (اختياري)",
  displayNamePlaceholder: "خادم ATM10",
  createBoard: "إنشاء لوحة",

  // Task-detail modal
  detailFallbackTitle: "مهمة",
  detailBody: "الوصف",
  detailSummary: "ملخص آخر تشغيل",
  detailResult: "النتيجة",
  detailComments: "التعليقات ({{count}})",
  detailEvents: "الأحداث ({{count}})",
  commentAnon: "مجهول",

  // Prompts / confirmations
  blockReasonPrompt: "سبب الحظر؟",
  confirmMarkDone: 'تعيين "{{title}}" كمكتمل؟',
  confirmArchive: 'أرشفة "{{title}}"؟',

  // Errors
  moveNotAllowed:
    "لا يمكن نقل {{from}} ← {{to}} من سطح المكتب. استخدم الوكيل أو CLI.",
  errLoadBoards: "فشل تحميل اللوحات",
  errLoadTasks: "فشل تحميل المهام",
  errMoveTask: "فشل نقل المهمة",
  errPickFolder: "اختر مجلد مساحة العمل أولاً.",
  errCreateTask: "فشل إنشاء المهمة",
  errSwitchBoard: "فشل تبديل اللوحة",
  errCreateBoard: "فشل إنشاء اللوحة",
  errSpecify: "فشل تحديد المهمة",
  errArchive: "فشل أرشفة المهمة",
  errReclaim: "فشل الاستعادة",
  errDispatch: "فشل التوزيع",

  // Tooltips & buttons
  hqBoardTooltip: "لوحة مقر Claw3D (نسخة للقراءة فقط)",
  dismissError: "تجاهل الخطأ",
  closeTaskDetails: "إغلاق تفاصيل المهمة",
} as const;
