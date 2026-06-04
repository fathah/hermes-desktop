export default {
  title: "Narzędzia",
  subtitle:
    "Włącz lub wyłącz zestawy narzędzi, których agent może używać podczas rozmów",
  web: {
    label: "Wyszukiwanie w sieci",
    description: "Przeszukuj sieć i wyciągaj treści z URL-i",
  },
  browser: {
    label: "Przeglądarka",
    description: "Nawiguj, klikaj, pisz i wchodź w interakcje ze stronami WWW",
  },
  terminal: {
    label: "Terminal",
    description: "Wykonuj polecenia powłoki i skrypty",
  },
  file: {
    label: "Operacje na plikach",
    description: "Czytaj, zapisuj, wyszukuj i zarządzaj plikami",
  },
  code_execution: {
    label: "Wykonywanie kodu",
    description: "Wykonuj bezpośrednio kod Python i polecenia powłoki",
  },
  vision: { label: "Wizja", description: "Analizuj obrazy i treści wizualne" },
  image_gen: {
    label: "Generowanie obrazów",
    description: "Generuj obrazy za pomocą DALL-E i innych modeli",
  },
  tts: { label: "Tekst na mowę", description: "Konwertuj tekst na mowę" },
  skills: {
    label: "Umiejętności",
    description: "Twórz, zarządzaj i uruchamiaj wielorazowe umiejętności",
  },
  memory: {
    label: "Pamięć",
    description: "Zapisuj i przywołuj trwałą wiedzę",
  },
  session_search: {
    label: "Wyszukiwanie sesji",
    description: "Przeszukuj poprzednie rozmowy",
  },
  clarify: {
    label: "Pytania doprecyzowujące",
    description: "Proś użytkownika o doprecyzowanie, gdy jest potrzebne",
  },
  delegation: {
    label: "Delegowanie",
    description: "Uruchamiaj podagentów do zadań równoległych",
  },
  cronjob: {
    label: "Zadania cron",
    description: "Twórz i zarządzaj zaplanowanymi zadaniami",
  },
  moa: {
    label: "Mixture of Agents",
    description: "Koordynuj wiele modeli AI razem",
  },
  todo: {
    label: "Planowanie zadań",
    description: "Twórz i zarządzaj listami zadań dla złożonych prac",
  },
  mcpServers: "Serwery MCP",
  mcpDescription:
    "Serwery Model Context Protocol skonfigurowane w config.yaml. Zarządzaj nimi przez <code>hermes mcp add/remove</code> w terminalu.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "wyłączone",
} as const;
