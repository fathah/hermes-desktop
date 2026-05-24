export default {
  title: "Ferramentas",
  subtitle:
    "Active ou desactive os conjuntos de ferramentas que o seu agente pode usar durante as conversas",
  web: {
    label: "Pesquisa na Web",
    description: "Pesquisa na web e extrai conteúdo de URLs",
  },
  browser: {
    label: "Navegador",
    description: "Navegar, clicar, escrever e interagir com páginas web",
  },
  terminal: {
    label: "Terminal",
    description: "Executar comandos de shell e scripts",
  },
  file: {
    label: "Operações de Ficheiro",
    description: "Lê, escreve, pesquisa e gere ficheiros",
  },
  code_execution: {
    label: "Execução de Código",
    description: "Executa código Python e shell diretamente",
  },
  vision: { label: "Visão", description: "Analisa imagens e conteúdo visual" },
  image_gen: {
    label: "Geração de Imagens",
    description: "Gera imagens com DALL-E e outros modelos",
  },
  tts: {
    label: "Texto para Voz",
    description: "Converte texto em áudio falado",
  },
  skills: {
    label: "Competências/Skills",
    description: "Cria, gere e executa competências reutilizáveis",
  },
  memory: {
    label: "Memória",
    description: "Armazena e recupera conhecimento persistente",
  },
  session_search: {
    label: "Pesquisa de Sessão",
    description: "Pesquisa em conversas passadas",
  },
  clarify: {
    label: "Perguntas de Esclarecimento",
    description: "Pede esclarecimentos ao utilizador quando necessário",
  },
  delegation: {
    label: "Delegação",
    description: "Inicia sub-agentes para tarefas paralelas",
  },
  cronjob: {
    label: "Cron Jobs",
    description: "Cria e gere tarefas agendadas",
  },
  moa: {
    label: "Mixture of Agents",
    description: "Coordena vários modelos de IA em conjunto",
  },
  todo: {
    label: "Planeamento de Tarefas",
    description: "Cria e gere listas de afazeres para tarefas complexas",
  },
  mcpServers: "Servidores MCP",
  mcpDescription:
    "Servidores Model Context Protocol configurados no config.yaml. Faça a gestão via <code>hermes mcp add/remove</code> no terminal.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "desactivado",
} as const;
