export default {
  title: "Ayarlar",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Görünüm",
    privacy: "Gizlilik",
    credentialPool: "Kimlik Bilgisi Havuzu",
  },
  nav: {
    groups: {
      general: "Genel",
      hermes: "Hermes One",
    },
    appearance: "Görünüm",
    language: "Dil",
    privacy: "Gizlilik",
    connection: "Bağlantı",
    network: "Ağ",
    data: "Veri",
    about: "Hakkında ve Güncellemeler",
    community: "Topluluk",
    logs: "Günlükler ve Tanılama",
  },
  theme: {
    label: "Tema",
    system: "Sistem",
    light: "Açık",
    dark: "Koyu",
  },
  roundedCorners: {
    label: "Yuvarlatılmış köşeler",
    hint: "Uygulama genelinde köşeli (kare) tasarım için kapatın",
  },
  font: {
    label: "Yazı Tipi",
    manrope: "Manrope",
    system: "Sistem",
    hint: "Arayüz yazı tipini seçin",
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
    hint: "Hermes One'ı iyileştirmeye yardımcı olmak için anonim, toplulaştırılmış kullanım verilerini projenin analiz hizmetine gönderir. İstediğiniz zaman kapatabilirsiniz.",
    disclosure: {
      uuid: "Yalnızca bu cihazda saklanan rastgele bir kurulum tanımlayıcısı (ad, e-posta veya hesap bilgisi yok).",
      platform: "İşletim sisteminiz, Electron sürümü ve Node.js sürümü.",
      navigation:
        "Uygulama içinde hangi ekranları ziyaret ettiğiniz (örn. Sohbet, Oturumlar, Ayarlar). Sohbet içeriği, komutlar, model yanıtları veya dosya içerikleri toplanmaz.",
      endpoint:
        "Veriler Hermes analiz hizmetine gönderilir (analytics.hermesone.org). Oturum kayıtları ve sayfa görüntüleme otomatik yakalaması devre dışıdır.",
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
  httpProxy: "HTTP Proxy",
  httpProxyHint:
    "Tüm giden bağlantılar için SOCKS veya HTTP proxy (otomatik algılama için boş bırakın)",
  saved: "Kaydedildi",
  providerHint:
    "Bir inference sağlayıcısı seçin veya API anahtarına göre otomatik algıla",
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
  customBaseUrlHint: "OpenAI uyumlu API endpoint'i",
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
    "Hermes API sunucusu URL'si (/health ve /v1/chat/completions endpoint'lerini sunmalıdır)",
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

  // Community
  communityTitle: "Topluluk",
  communityHint:
    "Sorular sormak, sorunları bildirmek ve diğer Hermes kullanıcılarıyla sohbet etmek için Discord kanalımıza katılın.",
  joinDiscord: "Discord Kanalına Katıl",

  // SSH & Server Config
  modeSsh: "SSH Tüneli",
  modeSshHint:
    "SSH üzerinden uzak bir Hermes'e tünel oluşturun — açık bağlantı noktası veya API anahtarı gerekmez.",
  sessionDisabledTitle:
    "Oturum geçmişi devre dışı — API_SERVER_KEY ayarlanmadı",
  sessionDisabledDesc:
    "Bir API sunucu anahtarı olmadan gateway oturum devam isteklerini doğrulayamaz. Mesajlar yine de gönderilir, ancak konuşma geçmişi yeniden başlatmalar arasında korunmaz.",
  generateKey: "Benim için bir anahtar oluştur ve kaydet",
  generating: "Üretiliyor…",
  remoteEnvTitle: "Uzak sunucuda API_SERVER_KEY değerini ayarlayın",
  remoteEnvSshDesc:
    "SSH modu: uzak sunucudaki ~/.hermes/profiles/<profile>/.env dosyasına API_SERVER_KEY=<anahtarınız> ekleyin, ardından oradaki gateway'i yeniden başlatın.",
  remoteEnvDesc:
    "Uzak mod: uzak Hermes sunucunuzdaki .env dosyasına API_SERVER_KEY=<anahtarınız> ekleyin, ardından gateway'i yeniden başlatın.",
  sshHost: "SSH Sunucusu",
  sshPort: "SSH Portu",
  sshUsername: "Kullanıcı Adı",
  sshKeyPath: "Özel Anahtar Yolu",
  sshKeyPathOptional: "(isteğe bağlı, varsayılan ~/.ssh/id_rsa)",
  sshRemotePort: "Uzak Hermes Portu",
  sshRemotePortDefault: "(varsayılan 8642)",
  sshHint:
    "Parola istemi olmadan ssh {{cmd}} komutunu çalıştırabildiğinizden emin olun. İlk bağlantı ana bilgisayar anahtarına güvenir ve bunu ~/.ssh/known_hosts dosyasına kaydeder; bu anahtar daha sonra değişirse SSH bağlantıyı reddedecektir.",
  sshHintWelcome:
    "Sistem SSH'inizi kullanır. Parola istemi olmadan ssh {{cmd}} komutunu zaten çalıştırabildiğinizden emin olun.",
  testingSsh: "SSH test ediliyor…",
  testSsh: "SSH Bağlantısını Test Et",
  connectSsh: "SSH ile Bağlan",
  sshTitle: "SSH ile Bağlan",
  sshSubtitle:
    "SSH üzerinden uzak bir Hermes'e tünel oluşturun — açık bağlantı noktası veya API anahtarı gerekmez.",
  sshHostPlaceholder: "192.168.1.100 veya sunucum.local",
  sshUsernamePlaceholder: "hermes",
  sshErrorRequired: "Sunucu ve kullanıcı adı gereklidir.",
  sshErrorConnection:
    "SSH üzerinden bağlanılamadı veya uzaktaki Hermes'e ulaşılamadı. Şunlardan emin olun:\n• SSH anahtarı doğru (veya varsayılan ~/.ssh/id_rsa çalışıyor)\n• Uzak sunucuda Hermes gateway'i çalışıyor\n• Uzak port doğru (varsayılan 8642)",
  sshErrorFailed: "SSH bağlantı testi başarısız oldu: {{msg}}",
  sshErrorFailedSimple: "SSH bağlantı testi başarısız oldu.",
  remoteErrorUrl: "Lütfen bir URL girin.",
  remoteErrorConnection:
    "Bu URL'deki Hermes'e ulaşılamadı. URL'yi ve API anahtarını kontrol edin.\n\nSunucu kimlik doğrulaması gerektirmeyen istekleri kabul ediyorsa (örn. localhost'a SSH tüneli üzerinden) anahtarı boş bırakın.",
  remoteErrorFailed: "Bağlantı testi başarısız oldu.",
  sshSuccess: "SSH tüneli bağlandı!",
  sshErrorRequiredSimple: "Sunucu ve kullanıcı adı gereklidir",
  remoteSuccess: "Başarıyla bağlandı!",
  remoteErrorRequiredSimple: "Lütfen bir URL girin",
  remoteErrorFailedSimple: "Sunucuya ulaşılamadı",
  apiGenerated: "API anahtarı oluşturuldu — gateway yeniden başlatılıyor…",
} as const;
