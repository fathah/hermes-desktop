export default {
  title: "Kanban",
  subtitle:
    "Ajanın alıp kendi başına tamamlayabileceği görevler için kalıcı çoklu ajan panosu.",

  // Header actions
  refresh: "Yenile",
  refreshTooltip: "Panoları ve görevleri ajandan yeniden yükle",
  dispatch: "Dağıt",
  dispatchTooltip:
    "Bir dağıtım geçişi çalıştır — hazır görevleri ilerlet ve çalışanları başlat",
  newTask: "Yeni görev",
  newTaskTooltip: "Mevcut panoda yeni bir görev oluştur",
  newBoard: "Yeni pano",
  newBoardTooltip: "Yeni bir kanban panosu oluştur",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "Kanban, yerel bir Hermes kurulumu veya SSH tünel modu gerektirir.",
  remoteUnsupportedHint:
    "Düz uzak (HTTP + API anahtarı) modu henüz kanban API'sini sunmamaktadır. Panoyu yönetmek için Ayarlar'dan yerel veya SSH tünel moduna geçin.",

  // Column / task statuses
  status: {
    triage: "Triyaj",
    todo: "Yapılacak",
    ready: "Hazır",
    running: "Çalışıyor",
    blocked: "Engellendi",
    done: "Tamamlandı",
  },

  // Card action tooltips
  cardSpecify: "Belirle (şartnameyi genişlet → yapılacak)",
  cardMarkDone: "Tamamlandı işaretle",
  cardReclaim: "Çalışanı geri al",
  cardUnblock: "Engeli kaldır",
  cardBlock: "Engelle",
  cardArchive: "Arşivle",

  // Create-task modal
  createTitle: "Yeni kanban görevi",
  fieldTitle: "Başlık",
  titlePlaceholder: "Ne yapılması gerekiyor?",
  fieldBody: "Açıklama (isteğe bağlı)",
  bodyPlaceholder: "Bağlam, kabul kriterleri, bağlantılar…",
  fieldAssignee: "Atanan profil",
  assigneeNone: "— Triyaj (atanan yok)",
  fieldPriority: "Öncelik",
  priorityNormal: "Normal (0)",
  priorityLow: "Düşük (P2)",
  priorityHigh: "Yüksek (P1)",
  priorityUrgent: "Acil (P0)",
  fieldWorkspace: "Çalışma Alanı",
  workspaceScratch: "Geçici (temp klasörü)",
  workspaceWorktree: "Çalışma Ağacı (mevcut repo)",
  workspaceChoose: "Klasör seç…",
  workspaceNoFolder: "Klasör seçilmedi",
  browse: "Gözat…",
  triageCheckbox:
    "Triyaja koy (bir belirleyici, yapılacak'a yükseltmeden önce şartnameyi genişletir)",
  create: "Görev oluştur",
  creating: "Oluşturuluyor…",

  // New-board modal
  newBoardTitle: "Yeni pano",
  fieldSlug: "Kısa ad",
  slugPlaceholder: "kebab-case, örn. atm10-server",
  fieldDisplayName: "Görünen ad (isteğe bağlı)",
  displayNamePlaceholder: "ATM10 Sunucusu",
  createBoard: "Pano oluştur",

  // Task-detail modal
  detailFallbackTitle: "Görev",
  detailBody: "Açıklama",
  detailSummary: "Son çalıştırma özeti",
  detailResult: "Sonuç",
  detailComments: "Yorumlar ({{count}})",
  detailEvents: "Olaylar ({{count}})",
  commentAnon: "anonim",

  // Prompts / confirmations
  blockReasonPrompt: "Engelleme sebebi?",
  confirmMarkDone: '"{{title}}" tamamlandı olarak işaretlensin mi?',
  confirmArchive: '"{{title}}" arşivlensin mi?',

  // Errors
  moveNotAllowed:
    "Masaüstünden {{from}} → {{to}} taşınamaz. Ajanı veya CLI'ı kullanın.",
  errLoadBoards: "Panolar yüklenemedi",
  errLoadTasks: "Görevler yüklenemedi",
  errMoveTask: "Görev taşınamadı",
  errPickFolder: "Önce bir çalışma alanı klasörü seçin.",
  errCreateTask: "Görev oluşturulamadı",
  errSwitchBoard: "Pano değiştirilemedi",
  errCreateBoard: "Pano oluşturulamadı",
  errSpecify: "Görev belirlenemedi",
  errArchive: "Görev arşivlenemedi",
  errReclaim: "Geri alınamadı",
  errDispatch: "Dağıtım başarısız",
} as const;
