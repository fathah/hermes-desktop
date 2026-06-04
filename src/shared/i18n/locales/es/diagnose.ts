export default {
  title: "Estado de la configuración",
  description:
    "Auditoría de la configuración del escritorio (variables de entorno, config.yaml, modelos). Detecta inconsistencias que suelen causar fallos en el chat, con correcciones de un clic cuando es seguro aplicarlas automáticamente.",
  rerun: "Volver a ejecutar auditoría",
  allGood: "No se detectaron problemas. Tu configuración parece consistente.",
  banner: {
    lead: "Problemas de configuración detectados:",
    errors: "{{count}} error(es)",
    warnings: "{{count}} advertencia(s)",
    infos: "{{count}} nota(s)",
    showDetails: "Mostrar detalles",
  },
  fix: {
    apply: "Aplicar corrección",
    running: "Aplicando…",
    success: "Corrección aplicada.",
    failure: "La corrección falló.",
  },
};
