export default {
  title: "Araçlar",
  subtitle:
    "Ajanın konuşmalar sırasında kullanabileceği araç setlerini etkinleştirin veya devre dışı bırakın",
  web: {
    label: "Web Arama",
    description: "İnternette arama yapın ve URL'lerden içerik çıkarın",
  },
  browser: {
    label: "Tarayıcı",
    description: "Web sayfalarında gezinin, tıklayın, yazın ve etkileşim kurun",
  },
  terminal: {
    label: "Terminal",
    description: "Kabuk komutlarını ve betikleri çalıştırın",
  },
  file: {
    label: "Dosya İşlemleri",
    description: "Dosyaları okuyun, yazın, arayın ve yönetin",
  },
  code_execution: {
    label: "Kod Çalıştırma",
    description: "Python ve kabuk kodunu doğrudan çalıştırın",
  },
  vision: {
    label: "Görüntü",
    description: "Görselleri ve görsel içeriği analiz edin",
  },
  image_gen: {
    label: "Görsel Oluşturma",
    description: "DALL-E ve diğer modellerle görsel oluşturun",
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
    "config.yaml dosyasında yapılandırılan Model Context Protocol sunucuları. Terminalde <code>hermes mcp add/remove</code> ile yönetin.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "devre dışı",
} as const;
