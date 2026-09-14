export default {
  title: "Configurações",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Aparência",
    privacy: "Privacidade",
    credentialPool: "Pool de Credenciais",
  },
  nav: {
    groups: {
      general: "Geral",
      hermes: "Hermes One",
    },
    appearance: "Aparência",
    language: "Idioma",
    privacy: "Privacidade",
    connection: "Conexão",
    network: "Rede",
    data: "Dados",
    about: "Sobre e atualizações",
    community: "Comunidade",
    logs: "Registros e diagnósticos",
  },
  analytics: {
    label: "Enviar análises de uso anônimas",
    hint: "Ajuda a melhorar o Hermes enviando dados de uso anônimos e agregados para o serviço de análise do projeto. Você pode desativar a qualquer momento.",
    disclosure: {
      uuid: "Um identificador aleatório por instalação armazenado apenas neste dispositivo (sem nome, e-mail ou dados de conta).",
      platform:
        "Seu sistema operacional, versão do Electron e versão do Node.js.",
      navigation:
        "Quais telas você abre dentro do app (ex.: Chat, Sessões, Configurações). Conteúdo de chats, prompts, respostas do modelo e conteúdo de arquivos não são coletados.",
      endpoint:
        "Os dados são enviados para o serviço de análise do Hermes (analytics.hermesone.org). Gravações de sessão e captura automática de pageviews estão desativadas.",
      notCollected:
        "Nunca coletado: mensagens de chat, caminhos de arquivos, chaves de API, configuração do modelo, credenciais de conta.",
    },
  },
  theme: {
    label: "Tema",
    system: "Sistema",
    light: "Claro",
    dark: "Escuro",
  },
  language: {
    label: "Idioma",
    english: "English",
    indonesian: "Indonesio",
    japanese: "日本語",
    chinese: "中文",
    portuguese: "Português",
    hint: "Escolha o idioma da interface",
  },
  notDetected: "Não detectado",
  updatedSuccessfully: "Atualizado com sucesso!",
  updateSuccess: "Hermes atualizado com sucesso.",
  updateFailed: "Falha na atualização.",
  version: "v{{version}}",
  proxyPlaceholder: "ex: socks5://127.0.0.1:1080 ou http://proxy:8080",
  modelNamePlaceholder: "ex: anthropic/claude-opus-4.6",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  networkSection: "Rede",
  forceIpv4: "Forçar IPv4",
  forceIpv4Hint:
    "Desativar IPv6 para corrigir problemas de tempo limite de conexão em algumas redes",
  httpProxy: "Proxy HTTP",
  httpProxyHint:
    "Proxy SOCKS ou HTTP para todas as conexões de saída (deixe em branco para detecção automática)",
  saved: "Salvo",
  providerHint:
    "Selecione um provedor de inferência ou detecte automaticamente com base na Chave da API",
  customProviderHint:
    "Use qualquer API compatível com OpenAI (LM Studio, Ollama, vLLM, etc.)",
  modelHint:
    "Nome do modelo padrão (deixe em branco para usar o padrão do provedor)",
  refreshModels: "Atualizar lista de modelos",
  discoveringModels: "Carregando modelos disponíveis…",
  discoveredCount:
    "{{count}} modelos disponíveis — comece a digitar para filtrar",
  discoveryNoKey:
    "Defina a chave de API deste provedor no .env para carregar a lista de modelos disponíveis",
  discoveryError:
    "Não foi possível acessar a lista de modelos do provedor — você ainda pode digitar um nome de modelo",
  customBaseUrlHint: "Endpoint da API compatível com OpenAI",
  poolHint:
    "Adicione várias chaves de API para o mesmo provedor para rotação automática e balanceamento de carga. O Hermes alternará entre elas.",
  add: "Adicionar",
  remove: "Remover",
  keyLabel: "Chave",
  empty: "(vazio)",
  dataSection: "Dados",
  dataHint:
    "Exporte ou importe sua configuração do Hermes, sessões, habilidades e memória.",
  backingUp: "Fazendo backup...",
  exportBackup: "Exportar Backup",
  importing: "Importando...",
  importBackup: "Importar Backup",
  logsSection: "Logs",
  refresh: "Atualizar",
  emptyLog: "(vazio)",
  updating: "Atualizando...",
  updateEngine: "Atualizar Motor",
  latestVersion: "Já está atualizado",
  runningDiagnosis: "Executando diagnóstico...",
  runDiagnosis: "Executar Diagnóstico",
  running: "Executando...",
  debugDump: "Dump de Depuração",
  migrationDetected: "Instalação do OpenClaw Detectada",
  migrationDesc:
    "Encontramos o OpenClaw em <code>{{path}}</code>. Você pode migrar sua configuração, chaves de API, sessões e habilidades para o Hermes.",
  migrationDismiss: "Não mostrar novamente",
  migrating: "Migrando...",
  migrateToHermes: "Migrar para o Hermes",
  skip: "Pular",
  appearanceHint: "Escolha a aparência preferida da interface",
  apiKeyPlaceholder: "Chave da API",
  labelPlaceholder: "Rótulo ({{optional}})",
  connectionSection: "Conexão",
  modeLocal: "Local",
  modeRemote: "Remoto",
  modeLocalHint: "Usando o Hermes instalado neste dispositivo",
  modeRemoteHint:
    "Conectar a um servidor da API do Hermes na sua rede ou nuvem",
  remoteUrl: "URL Remota",
  remoteUrlHint:
    "A URL do servidor da API do Hermes (deve expor /health e /v1/chat/completions)",
  remoteApiKey: "Chave da API",
  remoteApiKeyHint:
    "Deve coincidir com a API_SERVER_KEY no host remoto. Deixe vazio se o servidor aceitar requisições não autenticadas.",
  testingConnection: "Testando...",
  testConnection: "Testar Conexão",
  save: "Salvar",
  serverConfigTitle: "Configuração do Servidor",
  serverConfigHint:
    "Você está conectado a um servidor remoto do Hermes. A seleção de modelos, as chaves de API dos provedores e as credenciais são gerenciadas no host remoto em <code>~/.hermes/.env</code> e <code>config.yaml</code>. Edite-os lá e reinicie o servidor.",
  connectionMode: "Modo",
  switchedToLocal: "Mudou para o modo local",
} as const;
