export default {
  title: "Diagnóstico de configuração",
  description:
    "Auditoria à configuração do desktop (variáveis de ambiente, config.yaml, modelos). Apresenta inconsistências que costumam causar falhas no chat, com correcções automáticas onde é seguro aplicá-las.",
  rerun: "Repetir auditoria",
  allGood: "Nenhum problema detectado. A configuração parece consistente.",
  banner: {
    lead: "Problemas de configuração detectados:",
    errors: "{{count}} erro(s)",
    warnings: "{{count}} aviso(s)",
    infos: "{{count}} nota(s)",
    showDetails: "Mostrar detalhes",
  },
  fix: {
    apply: "Aplicar correcção",
    running: "A aplicar…",
    success: "Correcção aplicada.",
    failure: "A correcção falhou.",
  },
};
