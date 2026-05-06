export default {
  title: "Ferramentas",
  subtitle: "Ative ou desative os conjuntos de ferramentas que seu agente pode usar durante as conversas",
  web: {
    label: "Pesquisa na Web",
    description: "Pesquisa na web e extrai conteúdo de URLs",
  },
  browser: {
    label: "Navegador",
    description: "Navega, clica, digita e interage com páginas da web",
  },
  terminal: {
    label: "Terminal",
    description: "Executa comandos de shell e scripts",
  },
  file: {
    label: "Operações de Arquivo",
    description: "Lê, escreve, pesquisa e gerencia arquivos",
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
  tts: { label: "Texto para Voz", description: "Converte texto em áudio falado" },
  skills: {
    label: "Habilidades",
    description: "Cria, gerencia e executa habilidades reutilizáveis",
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
    description: "Pede esclarecimentos ao usuário quando necessário",
  },
  delegation: {
    label: "Delegação",
    description: "Inicia sub-agentes para tarefas paralelas",
  },
  cronjob: {
    label: "Cron Jobs",
    description: "Cria e gerencia tarefas agendadas",
  },
  moa: {
    label: "Mixture of Agents",
    description: "Coordena vários modelos de IA juntos",
  },
  todo: {
    label: "Planejamento de Tarefas",
    description: "Cria e gerencia listas de afazeres para tarefas complexas",
  },
  mcpServers: "Servidores MCP",
  mcpDescription: "Servidores Model Context Protocol configurados no config.yaml. Gerencie via <code>hermes mcp add/remove</code> no terminal.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "desativado",
} as const;
