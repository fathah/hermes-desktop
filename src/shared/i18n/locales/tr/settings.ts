export default {
  title: "Ayarlar",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Görünüm",
    privacy: "Gizlilik",
    credentialPool: "Kimlik Bilgisi Havuzu",
  },
  theme: {
    label: "Tema",
    system: "Sistem",
    light: "Açık",
    dark: "Koyu",
  },
  language: {
    label: "Dil",
    english: "English",
    indonesian: "Bahasa Indonesia",
    japanese: "日本語",
    spanish: "Español",
    chinese: "中文",
    portuguese: "Portuguese",
    turkish: "Türkçe",
    hint: "Arayüz dilini seçin",
  },
  analytics: {
    label: "Anonim kullanım istatistikleri gönder",
    hint: "Hermes Desktop'u iyileştirmeye yardımcı olmak için anonim, toplulaştırılmış kullanım verilerini projenin PostHog örneğine gönderir. İstediğiniz zaman kapatabilirsiniz.",
    disclosure: {
      uuid: "Yalnızca bu cihazda saklanan rastgele bir kurulum tanımlayıcısı (ad, e-posta veya hesap bilgisi yok).",
      platform: "İşletim sisteminiz, Electron sürümü ve Node.js sürümü.",
      navigation:
        "Uygulama içinde hangi ekranları ziyaret ettiğiniz (örn. Sohbet, Oturumlar, Ayarlar). Sohbet içeriği, komutlar, model yanıtları veya dosya içerikleri toplanmaz.",
      endpoint:
        "Veriler us.i.posthog.com adresine gönderilir (PostHog ABD bulutu). Oturum kayıtları ve sayfa görüntüleme otomatik yakalaması devre dışıdır.",
      notCollected:
        "Asla toplanmaz: sohbet mesajları, dosya yolları, API anahtarları, model yapılandırması, hesap bilgileri.",
    },
  },
  notDetected: "Algılanmadı",
  updatedSuccessfully: "Başarıyla güncellendi!",
  updateSuccess: "Hermes başarıyla güncellendi.",
  updateFailed: "Güncelleme başarısız.",
  version: "v{{version}}",
  proxyPlaceholder: "örn. socks5://127.0.0.1:1080 veya http://proxy:8080",
  modelNamePlaceholder: "örn. anthropic/claude-opus-4.6",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  networkSection: "Ağ",
  forceIpv4: "IPv4'ü Zorla",
  forceIpv4Hint:
    "Bazı ağlarda bağlantı zaman aşımı sorunlarını düzeltmek için IPv6'yı devre dışı bırakın",
  httpProxy: "HTTP Vekil Sunucu",
  httpProxyHint:
    "Tüm giden bağlantılar için SOCKS veya HTTP vekil sunucu (otomatik algılama için boş bırakın)",
  saved: "Kaydedildi",
  providerHint:
    "Bir çıkarım sağlayıcısı seçin veya API Anahtarına göre otomatik algıla",
  customProviderHint:
    "Herhangi bir OpenAI uyumlu API kullanın (LM Studio, Ollama, vLLM, vb.)",
  modelHint:
    "Varsayılan model adı (sağlayıcı varsayılanını kullanmak için boş bırakın)",
  refreshModels: "Model listesini yenile",
  discoveringModels: "Kullanılabilir modeller yükleniyor…",
  discoveredCount: "{{count}} model mevcut — filtrelemek için yazmaya başlayın",
  discoveryNoKey:
    "Kullanılabilir model listesini yüklemek için bu sağlayıcının API anahtarını .env dosyasına ekleyin",
  discoveryError:
    "Sağlayıcının model listesine ulaşılamadı — yine de bir model adı yazabilirsiniz",
  customBaseUrlHint: "OpenAI uyumlu API uç noktası",
  poolHint:
    "Otomatik dönüşüm ve yük dengelemesi için aynı sağlayıcıya birden çok API Anahtarı ekleyin. Hermes bunlar arasında geçiş yapacaktır.",
  add: "Ekle",
  remove: "Kaldır",
  keyLabel: "Anahtar",
  empty: "(boş)",
  dataSection: "Veri",
  dataHint:
    "Hermes yapılandırmanızı, oturumlarınızı, yeteneklerinizi ve belleğinizi dışa veya içe aktarın.",
  backingUp: "Yedekleniyor...",
  exportBackup: "Yedek Dışa Aktar",
  importing: "İçe aktarılıyor...",
  importBackup: "Yedek İçe Aktar",
  logsSection: "Günlükler",
  refresh: "Yenile",
  emptyLog: "(boş)",
  updating: "Güncelleniyor...",
  updateEngine: "Motoru Güncelle",
  latestVersion: "Zaten güncel",
  runningDiagnosis: "Tanı çalıştırılıyor...",
  runDiagnosis: "Tanı Çalıştır",
  running: "Çalışıyor...",
  debugDump: "Hata Ayıklama Dökümü",
  migrationDetected: "OpenClaw Kurulumu Bulundu",
  migrationDesc:
    "<code>{{path}}</code> adresinde OpenClaw bulundu. Yapılandırmanızı, API anahtarlarınızı, oturumlarınızı ve yeteneklerinizi Hermes'e taşıyabilirsiniz.",
  migrationDismiss: "Tekrar gösterme",
  migrating: "Taşınıyor...",
  migrateToHermes: "Hermes'e Taşı",
  skip: "Geç",
  appearanceHint: "Tercih ettiğiniz arayüz görünümünü seçin",
  apiKeyPlaceholder: "API Anahtarı",
  labelPlaceholder: "Etiket ({{optional}})",
  connectionSection: "Bağlantı",
  modeLocal: "Yerel",
  modeRemote: "Uzak",
  modeLocalHint: "Bu cihazda yüklü Hermes kullanılıyor",
  modeRemoteHint:
    "Ağınızdaki veya buluttaki bir Hermes API sunucusuna bağlanın",
  remoteUrl: "Uzak URL",
  remoteUrlHint:
    "Hermes API sunucusu URL'si (/health ve /v1/chat/completions uç noktalarını sunmalıdır)",
  remoteApiKey: "API Anahtarı",
  remoteApiKeyHint:
    "Uzak sunucudaki API_SERVER_KEY ile eşleşir. Sunucu kimlik doğrulamasız istekleri kabul ediyorsa boş bırakın.",
  testingConnection: "Test ediliyor...",
  testConnection: "Bağlantıyı Test Et",
  save: "Kaydet",
  serverConfigTitle: "Sunucu Yapılandırması",
  serverConfigHint:
    "Uzak bir Hermes sunucusuna bağlandınız. Model seçimi, sağlayıcı API anahtarları ve kimlik bilgileri sunucunun <code>~/.hermes/.env</code> ve <code>config.yaml</code> dosyalarında yönetilir. Bunları ana bilgisayarda düzenleyin (örn. <code>docker exec -it hermes vi /opt/data/.env</code>) ve kabı yeniden başlatın.",
  connectionMode: "Mod",
  switchedToLocal: "Yerel moda geçildi",
} as const;
