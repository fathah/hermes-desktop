export default {
  title: "Bellek",
  subtitle:
    "Hermes'in oturumlar arasında sizin ve ortamınız hakkında hatırladıkları.",
  sessions: "Oturumlar",
  messages: "Mesajlar",
  memories: "Anılar",
  providersTitle: "Sağlayıcılar",
  agentMemory: "Ajan Belleği",
  userProfile: "Kullanıcı Profili",
  entries: "{{count}} girdi",
  addMemory: "Bellek Ekle",
  addFailed: "Girdi eklenemedi",
  updateFailed: "Girdi güncellenemedi",
  saveFailed: "Kaydedilemedi",
  entriesPlaceholder:
    "örn. Kullanıcı TypeScript'i JavaScript'e tercih eder. Her zaman sıkı mod kullan.",
  userProfilePlaceholder:
    "örn. Ad: Alex. Kıdemli geliştirici. Kısa yanıtları tercih eder. macOS ve zsh kullanır. Saat dilimi: PST.",
  noProvidersFound: "Bu kurulumda bellek sağlayıcısı bulunamadı.",
  openProviderWebsite: "Sağlayıcı web sitesini aç",
  noMemoriesYet:
    "Henüz anı yok. Hermes sohbet ederken önemli bilgileri kaydedecek.",
  noMemoryEntries: "Henüz bellek girdisi yok.",
  noToolsetsFound: "Araç seti bulunamadı.",
  addManuallyHint:
    "Yukarıdaki butonu kullanarak belleğe manuel olarak da ekleme yapabilirsiniz.",
  userProfileHint:
    "Hermes'e kendinizden bahsedin — ad, rol, tercihler, iletişim tarzı.",
  providersHint:
    "Takılabilir bellek sağlayıcıları, Hermes'e gelişmiş uzun süreli bellek verir. Yerleşik bellek (yukarıda) seçilen sağlayıcının yanında her zaman aktiftir.",
  providersHintActive: "Aktif: <strong>{{provider}}</strong>",
  providersHintInactive:
    "Harici sağlayıcı aktif değil — yalnızca yerleşik bellek kullanılıyor.",
  enterEnvKey: "{{key}} girin",
  chars: "{{count}} karakter",
  cancel: "İptal",
  save: "Kaydet",
  edit: "Düzenle",
  deleteConfirm: "Sil?",
  yes: "Evet",
  no: "Hayır",
  saveProfile: "Profili Kaydet",
  active: "Aktif",
  deactivate: "Devre Dışı Bırak",
  activating: "Etkinleştiriliyor...",
  activate: "Etkinleştir",
  providers: {
    honcho:
      "Yapay zeka odaklı oturumlar arası kullanıcı modelleme, diyalektik soru-cevap ve anlamsal arama",
    hindsight: "Bilgi grafiği ve çoklu strateji getirme ile uzun süreli bellek",
    mem0: "Sunucu tarafı LLM bilgi çıkarma, anlamsal arama ve otomatik yineleme kaldırma",
    retaindb: "Hibrit arama ve 7 bellek türü ile bulut bellek API'si",
    supermemory:
      "Profil hatırlama ve varlık çıkarma ile anlamsal uzun süreli bellek",
    holographic:
      "FTS5 arama ve güven puanlaması ile yerel SQLite bilgi deposu (API anahtarı gerekmez)",
    openviking: "Katmanlı getirme ve bilgi gezinme ile oturum yönetimli bellek",
    byterover: "brv CLI ile katmanlı getirme ve kalıcı bilgi ağacı",
  },
} as const;
