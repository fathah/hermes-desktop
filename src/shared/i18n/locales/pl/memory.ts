export default {
  title: "Pamięć",
  subtitle: "Co Hermes pamięta o Tobie i Twoim środowisku między sesjami.",
  sessions: "Sesje",
  messages: "Wiadomości",
  memories: "Wspomnienia",
  providersTitle: "Dostawcy",
  agentMemory: "Pamięć agenta",
  userProfile: "Profil użytkownika",
  entries: "{{count}} wpisów",
  addMemory: "Dodaj pamięć",
  addFailed: "Nie udało się dodać wpisu",
  updateFailed: "Nie udało się zaktualizować wpisu",
  saveFailed: "Nie udało się zapisać",
  entriesPlaceholder:
    "np. Użytkownik preferuje TypeScript zamiast JavaScript. Zawsze używaj trybu strict.",
  userProfilePlaceholder:
    "np. Imię: Alex. Senior developer. Preferuje zwięzłe odpowiedzi. Używa macOS z zsh. Strefa czasowa: PST.",
  noProvidersFound: "Nie znaleziono dostawców pamięci w tej instalacji.",
  openProviderWebsite: "Otwórz stronę dostawcy",
  noMemoriesYet:
    "Brak pamięci. Hermes będzie zapisywał ważne fakty podczas rozmowy.",
  noMemoryEntries: "Brak wpisów pamięci.",
  noToolsetsFound: "Nie znaleziono zestawów narzędzi.",
  addManuallyHint: "Możesz też dodać wspomnienia ręcznie przyciskiem powyżej.",
  userProfileHint:
    "Powiedz Hermesowi o sobie — imię, rola, preferencje, styl komunikacji.",
  providersHint:
    "Wtykowe dostawcy pamięci dają Hermesowi zaawansowaną pamięć długoterminową. Wbudowana pamięć (powyżej) zawsze działa razem z wybranym dostawcą.",
  providersHintActive: "Aktywny: <strong>{{provider}}</strong>",
  providersHintInactive:
    "Brak aktywnego zewnętrznego dostawcy — używana tylko wbudowana pamięć.",
  enterEnvKey: "Wpisz {{key}}",
  chars: "{{count}} znaków",
  cancel: "Anuluj",
  save: "Zapisz",
  edit: "Edytuj",
  deleteConfirm: "Usunąć?",
  yes: "Tak",
  no: "Nie",
  saveProfile: "Zapisz profil",
  active: "Aktywny",
  deactivate: "Dezaktywuj",
  activating: "Aktywowanie...",
  activate: "Aktywuj",
  providers: {
    honcho:
      "AI-natywne modelowanie użytkownika między sesjami z dialektycznym Q&A i wyszukiwaniem semantycznym",
    hindsight:
      "Pamięć długoterminowa z grafem wiedzy i wielostrategicznym wyszukiwaniem",
    mem0: "Serwerowa ekstrakcja faktów przez LLM z wyszukiwaniem semantycznym i autodeduplikacją",
    retaindb:
      "Chmurowe API pamięci z wyszukiwaniem hybrydowym i 7 typami pamięci",
    supermemory:
      "Semantyczna pamięć długoterminowa z przywoływaniem profilu i ekstrakcją encji",
    holographic:
      "Lokalny magazyn faktów SQLite z wyszukiwaniem FTS5 i oceną zaufania (bez klucza API)",
    openviking:
      "Pamięć zarządzana sesyjnie z warstwowym wyszukiwaniem i przeglądaniem wiedzy",
    byterover: "Trwałe drzewo wiedzy z warstwowym wyszukiwaniem przez brv CLI",
  },
} as const;
