export default {
  title: "Ustawienia",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Wygląd",
    privacy: "Prywatność",
    credentialPool: "Pula poświadczeń",
  },
  theme: {
    label: "Motyw",
    system: "Systemowy",
    light: "Jasny",
    dark: "Ciemny",
  },
  language: {
    label: "Język",
    english: "English",
    indonesian: "Bahasa Indonesia",
    japanese: "日本語",
    spanish: "Español",
    chinese: "中文",
    portuguese: "Portuguese",
    hint: "Wybierz język interfejsu",
  },
  analytics: {
    label: "Wysyłaj anonimową analitykę użycia",
    hint: "Pomaga ulepszać Hermes Desktop przez wysyłanie anonimowych, zagregowanych danych użycia do instancji PostHog projektu. Możesz to wyłączyć w dowolnym momencie.",
    disclosure: {
      uuid: "Losowy identyfikator instalacji przechowywany tylko na tym urządzeniu (bez imienia, e-maila ani danych konta).",
      platform: "Twój system operacyjny, wersja Electron i wersja Node.js.",
      navigation:
        "Ekrany odwiedzane w aplikacji (np. Czat, Sesje, Ustawienia). Nie zbieramy treści czatu, promptów, odpowiedzi modeli ani zawartości plików.",
      endpoint:
        "Dane są wysyłane do us.i.posthog.com (chmura PostHog US). Nagrywanie sesji i automatyczne przechwytywanie odsłon są wyłączone.",
      notCollected:
        "Nigdy nie zbieramy: wiadomości czatu, ścieżek plików, kluczy API, konfiguracji modeli, poświadczeń kont.",
    },
  },
  notDetected: "Nie wykryto",
  updatedSuccessfully: "Zaktualizowano pomyślnie!",
  updateSuccess: "Hermes został pomyślnie zaktualizowany.",
  updateFailed: "Aktualizacja nie powiodła się.",
  version: "v{{version}}",
  proxyPlaceholder: "np. socks5://127.0.0.1:1080 lub http://proxy:8080",
  modelNamePlaceholder: "np. anthropic/claude-opus-4.6",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  networkSection: "Sieć",
  forceIpv4: "Wymuś IPv4",
  forceIpv4Hint:
    "Wyłącz IPv6, aby naprawić problemy z timeoutami połączeń w niektórych sieciach",
  httpProxy: "Proxy HTTP",
  httpProxyHint:
    "Proxy SOCKS lub HTTP dla wszystkich połączeń wychodzących (zostaw puste dla autodetekcji)",
  saved: "Zapisano",
  providerHint:
    "Wybierz dostawcę inferencji albo autodetekcję na podstawie klucza API",
  customProviderHint:
    "Użyj dowolnego API zgodnego z OpenAI (LM Studio, Ollama, vLLM itd.)",
  modelHint:
    "Domyślna nazwa modelu (zostaw puste, aby użyć domyślnego modelu dostawcy)",
  refreshModels: "Odśwież listę modeli",
  discoveringModels: "Ładowanie dostępnych modeli…",
  discoveredCount:
    "Dostępnych modeli: {{count}} — zacznij pisać, aby filtrować",
  discoveryNoKey:
    "Ustaw klucz API tego dostawcy w .env, aby wczytać listę dostępnych modeli",
  discoveryError:
    "Nie udało się połączyć z listą modeli dostawcy — nadal możesz wpisać nazwę modelu ręcznie",
  customBaseUrlHint: "Endpoint API zgodny z OpenAI",
  poolHint:
    "Dodaj wiele kluczy API dla tego samego dostawcy, aby automatycznie rotować i równoważyć obciążenie. Hermes będzie ich używał cyklicznie.",
  add: "Dodaj",
  remove: "Usuń",
  keyLabel: "Klucz",
  empty: "(puste)",
  dataSection: "Dane",
  dataHint:
    "Eksportuj lub importuj konfigurację Hermes, sesje, umiejętności i pamięć.",
  backingUp: "Tworzenie kopii...",
  exportBackup: "Eksportuj kopię zapasową",
  importing: "Importowanie...",
  importBackup: "Importuj kopię zapasową",
  logsSection: "Logi",
  refresh: "Odśwież",
  emptyLog: "(puste)",
  updating: "Aktualizowanie...",
  updateEngine: "Aktualizuj silnik",
  latestVersion: "Już aktualne",
  runningDiagnosis: "Uruchamianie diagnostyki...",
  runDiagnosis: "Uruchom diagnostykę",
  running: "Działa...",
  debugDump: "Zrzut debugowania",
  migrationDetected: "Wykryto instalację OpenClaw",
  migrationDesc:
    "Znaleziono OpenClaw w <code>{{path}}</code>. Możesz przenieść konfigurację, klucze API, sesje i umiejętności do Hermes.",
  migrationDismiss: "Nie pokazuj ponownie",
  migrating: "Migrowanie...",
  migrateToHermes: "Migruj do Hermes",
  skip: "Pomiń",
  appearanceHint: "Wybierz preferowany wygląd interfejsu",
  apiKeyPlaceholder: "Klucz API",
  labelPlaceholder: "Etykieta ({{optional}})",
  connectionSection: "Połączenie",
  modeLocal: "Lokalny",
  modeRemote: "Zdalny",
  modeLocalHint: "Używasz Hermes zainstalowanego na tym urządzeniu",
  modeRemoteHint: "Połącz z serwerem API Hermes w sieci lub chmurze",
  remoteUrl: "Zdalny URL",
  remoteUrlHint:
    "URL serwera API Hermes (musi wystawiać /health i /v1/chat/completions)",
  remoteApiKey: "Klucz API",
  remoteApiKeyHint:
    "Musi odpowiadać API_SERVER_KEY na zdalnym hoście. Zostaw puste, jeśli serwer akceptuje żądania nieuwierzytelnione.",
  testingConnection: "Testowanie...",
  testConnection: "Testuj połączenie",
  save: "Zapisz",
  serverConfigTitle: "Konfiguracja serwera",
  serverConfigHint:
    "Jesteś połączony ze zdalnym serwerem Hermes. Wybór modelu, klucze API dostawców i poświadczenia są zarządzane na serwerze w <code>~/.hermes/.env</code> oraz <code>config.yaml</code>. Edytuj je na hoście (np. <code>docker exec -it hermes vi /opt/data/.env</code>) i zrestartuj kontener.",
  connectionMode: "Tryb",
  switchedToLocal: "Przełączono na tryb lokalny",
} as const;
