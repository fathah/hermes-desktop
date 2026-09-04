# Chat Experience Preferences

Chat presentation and notification preferences are renderer-owned, persisted locally, and applied through one app-level context.

[[src/renderer/src/components/ChatPreferencesProvider.tsx#ChatPreferencesProvider]] loads safe defaults, persists explicit choices in `localStorage`, and exposes them through [[src/renderer/src/components/ChatPreferencesProvider.tsx#useChatPreferences]]. The fallback context keeps isolated surfaces and mixed-version tests functional when a provider or newer preload method is absent.

## User message Markdown

User prompts use the same Markdown grammar as assistant text while keeping their original source available for copying.

[[src/renderer/src/screens/Chat/MessageRow.tsx#MessageRow]] renders user content through `AgentMarkdown`, including headings, lists, links, and tables. The user-bubble CSS preserves line breaks for ordinary prose, and the copy action still writes the untouched source string rather than rendered text. [[src/renderer/src/screens/Chat/MessageRow.test.tsx]] verifies rendered structure and raw-source copying together.

## Completion sound

The completion chime is enabled by default and can be disabled globally from Settings → Notifications.

[[src/renderer/src/components/settings/NotificationsPane.tsx#NotificationsPane]] exposes the master switch. [[src/renderer/src/screens/Chat/chatNotifications.ts#shouldPlayCompletionSound]] permits audio only on a generating-to-idle transition and when the stored preference is enabled, preventing preference changes and ordinary idle renders from producing a sound.

## Native spell checking

Spell checking is enabled by default and supports either system-preferred dictionaries or an explicit multi-language selection.

[[src/main/ipc/register.ts#registerIpcHandlers]] exposes the current Electron session's available, selected, and system-matched dictionaries, validates requested language ids, and applies the result with Electron's session spell-checker API. [[src/renderer/src/components/ChatPreferencesProvider.tsx#ChatPreferencesProvider]] persists enabled/system/custom choices and applies an empty list when spell checking is disabled. [[src/renderer/src/components/settings/LanguagePane.tsx#LanguagePane]] selects system or custom dictionaries, while [[src/renderer/src/screens/Chat/ChatInput.tsx]] binds the enabled flag to its textarea; the Electron session selection also governs other editable renderer fields. [[src/renderer/src/components/ChatPreferencesProvider.test.tsx]] protects persistence, multi-language application, and disabling.
