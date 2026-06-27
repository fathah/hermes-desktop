export default {
  title: "Инструменты",
  subtitle: "Включите или отключите наборы инструментов, которые ваш агент может использовать во время разговора",
  web: {
    label: "Веб-поиск",
    description: "Поиск в интернете и извлечение содержимого из URL",
  },
  browser: {
    label: "Браузер",
    description: "Навигация, клики, ввод текста и взаимодействие с веб-страницами",
  },
  terminal: {
    label: "Терминал",
    description: "Выполнение команд и скриптов оболочки",
  },
  file: {
    label: "Файловые операции",
    description: "Чтение, запись, поиск и управление файлами",
  },
  code_execution: {
    label: "Выполнение кода",
    description: "Выполнение Python и shell-кода напрямую",
  },
  vision: { label: "Восприятие", description: "Анализ изображений и визуального содержимого" },
  image_gen: {
    label: "Генерация изображений",
    description: "Генерация изображений с помощью DALL-E и других моделей",
  },
  tts: { label: "Синтез речи", description: "Преобразование текста в речь" },
  skills: {
    label: "Навыки",
    description: "Создание, управление и выполнение переиспользуемых навыков",
  },
  memory: {
    label: "Память",
    description: "Хранение и извлечение постоянных знаний",
  },
  session_search: {
    label: "Поиск сессий",
    description: "Поиск по прошлым разговорам",
  },
  clarify: {
    label: "Уточняющие вопросы",
    description: "Запрос уточнения у пользователя при необходимости",
  },
  delegation: {
    label: "Делегирование",
    description: "Создание под-агентов для параллельных задач",
  },
  cronjob: {
    label: "Задачи по расписанию",
    description: "Создание и управление запланированными задачами",
  },
  moa: {
    label: "Смесь агентов",
    description: "Координация нескольких AI-моделей вместе",
  },
  todo: {
    label: "Планирование задач",
    description: "Создание и управление списками дел для сложных задач",
  },
  mcpServers: "MCP серверы",
  mcpDescription: "Серверы Model Context Protocol, настроенные в config.yaml. Управление через <code>hermes mcp add/remove</code> в терминале.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "отключено",
} as const;