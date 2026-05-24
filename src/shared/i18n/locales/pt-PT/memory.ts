export default {
  title: "Memória",
  subtitle: "O que o Hermes se lembra sobre si e o seu ambiente entre sessões.",
  sessions: "Sessões",
  messages: "Mensagens",
  memories: "Memórias",
  providersTitle: "Fornecedores",
  agentMemory: "Memória do Agente",
  userProfile: "Perfil do Utilizador",
  entries: "{{count}} entradas",
  addMemory: "Adicionar Memória",
  addFailed: "Falha ao adicionar entrada",
  updateFailed: "Falha ao actualizar entrada",
  saveFailed: "Falha ao guardar",
  entriesPlaceholder:
    "ex: O utilizador prefere TypeScript em vez de JavaScript. Use sempre o modo estrito.",
  userProfilePlaceholder:
    "ex: Nome: Alex. Programador sénior. Prefere respostas concisas. Usa macOS com zsh. Fuso horário: PST.",
  noProvidersFound: "Nenhum fornecedor de memória encontrado nesta instalação.",
  openProviderWebsite: "Abrir site do fornecedor",
  noMemoriesYet:
    "Ainda sem memórias. O Hermes guardará factos importantes à medida que conversam.",
  noMemoryEntries: "Ainda sem entradas de memória.",
  noToolsetsFound: "Nenhum conjunto de ferramentas encontrado.",
  addManuallyHint:
    "Também pode adicionar memórias manualmente usando o botão acima.",
  userProfileHint:
    "Fale ao Hermes sobre si — nome, cargo, preferências, estilo de comunicação.",
  providersHint:
    "Fornecedores de memória modular dão ao Hermes uma memória de longo prazo avançada. A memória integrada (acima) está sempre activa em conjunto com o fornecedor seleccionado.",
  providersHintActive: "Activo: <strong>{{provider}}</strong>",
  providersHintInactive:
    "Nenhum fornecedor externo activo — a usar apenas a integrada.",
  enterEnvKey: "Introduza {{key}}",
  chars: "{{count}} caracteres",
  cancel: "Cancelar",
  save: "Guardar",
  edit: "Editar",
  deleteConfirm: "Eliminar?",
  yes: "Sim",
  no: "Não",
  saveProfile: "Guardar Perfil",
  active: "Activo",
  deactivate: "Desactivar",
  activating: "A activar...",
  activate: "Activar",
  providers: {
    honcho:
      "Modelação de utilizador entre sessões nativa de IA com Q&A dialéctico e pesquisa semântica",
    hindsight:
      "Memória de longo prazo com grafo de conhecimento e recuperação multiestratégia",
    mem0: "Extracção de factos por LLM no lado do servidor com pesquisa semântica e desduplicação automática",
    retaindb:
      "API de memória na nuvem com pesquisa híbrida e 7 tipos de memória",
    supermemory:
      "Memória semântica de longo prazo com recuperação de perfil e extracção de entidades",
    holographic:
      "Armazenamento local de factos em SQLite com pesquisa FTS5 e pontuação de confiança (sem necessidade de chave de API)",
    openviking:
      "Memória gerida por sessão com recuperação em camadas e navegação de conhecimento",
    byterover:
      "Árvore de conhecimento persistente com recuperação em camadas via CLI brv",
  },
} as const;
