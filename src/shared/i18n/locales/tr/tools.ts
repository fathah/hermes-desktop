export default {
  title: "Araçlar",
  subtitle:
    "Ajanın konuşmalar sırasında kullanabileceği araç setlerini etkinleştirin veya devre dışı bırakın",
  web: {
    label: "Web Arama",
    description: "İnternette arama yapın ve URL'lerden içerik çıkarın",
  },
  x_search: {
    label: "X Arama",
    description: "X (Twitter) üzerindeki gönderileri ve içerikleri arayın",
  },
  browser: {
    label: "Tarayıcı",
    description: "Web sayfalarında gezinin, tıklayın, yazın ve etkileşim kurun",
  },
  terminal: {
    label: "Terminal",
    description: "Shell komutlarını ve scriptleri çalıştırın",
  },
  file: {
    label: "Dosya İşlemleri",
    description: "Dosyaları okuyun, yazın, arayın ve yönetin",
  },
  code_execution: {
    label: "Kod Çalıştırma",
    description: "Python ve shell kodunu doğrudan çalıştırın",
  },
  computer_use: {
    label: "Bilgisayar Kullanımı",
    description:
      "Masaüstünü kontrol edin — fareyi hareket ettirin, tıklayın ve yazın",
  },
  vision: {
    label: "Görüntü",
    description: "Görselleri ve görsel içeriği analiz edin",
  },
  image_gen: {
    label: "Görsel Oluşturma",
    description: "DALL-E ve diğer modellerle görsel oluşturun",
  },
  video_gen: {
    label: "Video Oluşturma",
    description: "Metin veya görsel komutlarından video oluşturun",
  },
  tts: { label: "Metin-Ses", description: "Metni konuşmaya dönüştürün" },
  skills: {
    label: "Yetenekler",
    description:
      "Tekrar kullanılabilir yetenekler oluşturun, yönetin ve çalıştırın",
  },
  memory: {
    label: "Bellek",
    description: "Kalıcı bilgileri saklayın ve hatırlayın",
  },
  session_search: {
    label: "Oturum Arama",
    description: "Geçmiş konuşmalar arasında arama yapın",
  },
  clarify: {
    label: "Açıklayıcı Sorular",
    description: "Gerektiğinde kullanıcıdan açıklama isteyin",
  },
  delegation: {
    label: "Yetkilendirme",
    description: "Paralel görevler için alt ajanlar oluşturun",
  },
  cronjob: {
    label: "Zamanlanmış Görevler",
    description: "Zamanlanmış görevler oluşturun ve yönetin",
  },
  moa: {
    label: "Ajan Karışımı",
    description: "Birden çok yapay zeka modelini birlikte koordine edin",
  },
  todo: {
    label: "Görev Planlama",
    description:
      "Karmaşık görevler için yapılacaklar listesi oluşturun ve yönetin",
  },
  mcpServers: "MCP Sunucuları",
  mcpDescription:
    "Ajanı ek araçlarla genişleten Model Context Protocol sunucularını bağlayın.",
  http: "HTTP",
  stdio: "stdio",
  unknown: "bilinmeyen",
  disabled: "devre dışı",
  refresh: "Yenile",
  cancel: "İptal",
  close: "Kapat",
  mcpAddServer: "Sunucu ekle",
  mcpBrowseCatalog: "Kataloğa göz at",
  mcpSearch: "MCP sunucularını filtrele...",
  mcpNoResults: "Filtrenizle eşleşen MCP sunucusu bulunamadı.",
  mcpEmptyTitle: "Yapılandırılmış MCP sunucusu yok",
  mcpEmptyDescription:
    "Özel bir HTTP veya stdio sunucusu ekleyin ya da Hermes MCP kataloğundan birini kurun.",
  mcpLoadFailed: "MCP sunucuları yüklenemedi.",
  mcpAddFailed: "MCP sunucusu eklenemedi.",
  mcpRemoveFailed: "MCP sunucusu kaldırılamadı.",
  mcpToggleFailed: "MCP sunucusu güncellenemedi.",
  mcpTestFailed: "MCP sunucu bağlantı testi başarısız oldu.",
  mcpInstallFailed: "MCP sunucusu kurulamadı.",
  mcpAdded: "MCP sunucusu eklendi.",
  mcpRemoved: "MCP sunucusu kaldırıldı.",
  mcpEnabled: "MCP sunucusu etkinleştirildi.",
  mcpDisabled: "MCP sunucusu devre dışı bırakıldı.",
  mcpInstalled: "MCP sunucusu kuruldu.",
  mcpInstallStarted: "MCP sunucusu kurulumu arka planda başlatıldı.",
  mcpTestPassed: "MCP sunucusu bağlandı. {{count}} araç bulundu.",
  mcpRemoveConfirm: "{{name}} MCP sunucusu kaldırılsın mı?",
  mcpTest: "Bağlantıyı test et",
  mcpRemove: "Sunucuyu kaldır",
  mcpEnable: "Sunucuyu etkinleştir",
  mcpDisable: "Sunucuyu devre dışı bırak",
  mcpNoDetail: "Endpoint detayı yok",
  mcpName: "Ad",
  mcpTransport: "Aktarım (Transport)",
  mcpUrl: "URL",
  mcpAuth: "Kimlik Doğrulama",
  mcpAuthNone: "Yok",
  mcpAuthHeader: "Başlık (Header)",
  mcpCommand: "Komut",
  mcpArgs: "Argümanlar",
  mcpArgsHint: "Her satıra bir argüman.",
  mcpEnv: "Ortam Değişkenleri",
  mcpEnvHint: "Her satıra bir ANAHTAR=DEĞER çifti.",
  mcpCatalogLoading: "MCP kataloğu yükleniyor...",
  mcpCatalogLoadFailed: "MCP kataloğu yüklenemedi.",
  mcpCatalogEmpty: "Kullanılabilir katalog kaydı bulunamadı.",
  mcpInstall: "Kur",
  mcpInstalledStatus: "Kuruldu",
} as const;
