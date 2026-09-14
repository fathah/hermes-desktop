export default {
  title: "الذاكرة",
  subtitle: "ما يتذكره Hermes عنك وعن بيئتك عبر الجلسات.",
  sessions: "الجلسات",
  messages: "الرسائل",
  memories: "الذكريات",
  providersTitle: "المزوّدون",
  agentMemory: "ذاكرة الوكيل",
  userProfile: "ملف المستخدم",
  entries: "{{count}} مدخل",
  addMemory: "إضافة ذاكرة",
  loadFailed: "فشل تحميل الذاكرة",
  addFailed: "فشل إضافة مدخل",
  updateFailed: "فشل تحديث المدخل",
  saveFailed: "فشل الحفظ",
  entriesPlaceholder:
    "مثال: يفضل المستخدم TypeScript على JavaScript. استخدم الوضع الصارم دائماً.",
  userProfilePlaceholder:
    "مثال: الاسم: أحمد. مطور أول. يفضل الإجابات المختصرة. يستخدم macOS مع zsh. المنطقة الزمنية: +3.",
  noProvidersFound: "لم يتم العثور على مزوّدي ذاكرة في هذا التثبيت.",
  openProviderWebsite: "فتح موقع المزوّد",
  noMemoriesYet:
    "لا توجد ذكريات بعد. سيحفظ Hermes الحقائق المهمة أثناء المحادثة.",
  noMemoryEntries: "لا توجد مدخلات ذاكرة بعد.",
  noToolsetsFound: "لم يتم العثور على مجموعات أدوات.",
  addManuallyHint: "يمكنك أيضاً إضافة ذكريات يدوياً باستخدام الزر أعلاه.",
  userProfileHint:
    "أخبر Hermes عن نفسك — الاسم، الدور، التفضيلات، أسلوب التواصل.",
  providersHint:
    "مزوّدو الذاكرة القابلون للتوصيل يمنحون Hermes ذاكرة طويلة المدى متقدمة. الذاكرة المدمجة (أعلاه) نشطة دائماً بجانب المزوّد المختار.",
  providersHintActive: "النشط: <strong>{{provider}}</strong>",
  providersHintInactive: "لا يوجد مزوّد خارجي نشط — استخدام المدمج فقط.",
  enterEnvKey: "أدخل {{key}}",
  chars: "{{count}} حرف",
  cancel: "إلغاء",
  save: "حفظ",
  edit: "تعديل",
  deleteConfirm: "حذف؟",
  yes: "نعم",
  no: "لا",
  saveProfile: "حفظ الملف الشخصي",
  active: "نشط",
  deactivate: "إلغاء التنشيط",
  activating: "جارٍ التنشيط...",
  activate: "تنشيط",
  providers: {
    honcho: "نمذجة مستخدم ذكية عبر الجلسات مع أسئلة وأجوبة جدلية وبحث دلالي",
    hindsight:
      "ذاكرة طويلة المدى مع رسم بياني معرفي واسترجاع متعدد الاستراتيجيات",
    mem0: "استخراج حقائق LLM من جهة الخادم مع بحث دلالي وإلغاء تكرار تلقائي",
    retaindb: "API ذاكرة سحابية مع بحث هجين و 7 أنواع ذاكرة",
    supermemory:
      "ذاكرة دلالية طويلة المدى مع استدعاء الملف الشخصي واستخراج الكيانات",
    holographic:
      "مخزن حقائق SQLite محلي مع بحث FTS5 وتقييم ثقة (لا يحتاج مفتاح API)",
    openviking: "ذاكرة مدارة بالجلسات مع استرجاع متدرج وتصفح المعرفة",
    byterover: "شجرة معرفة دائمة مع استرجاع متدرج عبر CLI brv",
  },
} as const;
