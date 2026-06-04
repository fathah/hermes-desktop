export default {
  title: "Yapılandırma Sağlığı",
  description:
    "Masaüstü yapılandırmasının denetimi (ortam değişkenleri, config.yaml, modeller). Sohbetin başarısız olmasına neden olan tutarsızlıkları bulur ve güvenli olduğunda tek tıkla düzeltme sunar.",
  rerun: "Denetimi yeniden çalıştır",
  allGood: "Sorun bulunamadı. Yapılandırmanız tutarlı görünüyor.",
  banner: {
    lead: "Yapılandırma sorunları tespit edildi:",
    errors: "{{count}} hata",
    warnings: "{{count}} uyarı",
    infos: "{{count}} not",
    showDetails: "Ayrıntıları göster",
  },
  fix: {
    apply: "Düzeltmeyi uygula",
    running: "Uygulanıyor…",
    success: "Düzeltme uygulandı.",
    failure: "Düzeltme başarısız.",
  },
};
