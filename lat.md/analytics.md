# Analytics

Privacy-first, opt-out usage analytics that report anonymous events to the in-house Hermes analytics service. Replaces the former PostHog integration; no third-party analytics SDK is bundled.

Events are sent directly over `fetch` from the renderer — there is no client library. Each event POSTs to `{VITE_ANALYTICS_BASE_URL}/v1/events` with an `x-api-key: {VITE_ANALYTICS_API_KEY}` header and a JSON body of `{ anonymous_id, event, source: "desktop", properties }`. The base URL and API key are injected at build time from GitHub Actions secrets, so analytics is silently disabled in local and unofficial builds where neither is configured. It is also disabled on the Vite dev server — [[src/renderer/src/utils/analytics.ts#isConfigured]] short-circuits when `import.meta.env.DEV` is true, since the `http://localhost:5173` dev origin isn't allowed by the service's CORS (every request would just fail preflight and spam the console). Packaged builds run `vite build`, so they are unaffected.

## Per-install identity

A random UUID created on first launch and persisted in `localStorage` under `hermes-anonymous-id` is the analytics user id — created if absent, reused if present.

It contains no PII and never leaves the device except as the `anonymous_id` field on events.

[[src/renderer/src/utils/analytics.ts]] owns this logic. `getOrCreateAnonymousId` reads or mints the id; `resetAnalytics` clears it so a fresh id is minted on the next event.

## Consent

Analytics is opt-out: enabled by default when the endpoint is configured, and the user can disable it from Settings. The choice is stored in `localStorage` under `hermes-analytics-enabled`.

[[src/renderer/src/components/settings/PrivacyPane.tsx#PrivacyPane]] (the Privacy pane of the settings modal) renders the toggle and a short one-line privacy note, calling `setAnalyticsConsent`; the initial state comes from `getAnalyticsConsent` in [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]]. When consent is off, `capture` short-circuits and no requests are made.

## Capture surface

`initAnalytics` runs once at renderer startup from [[src/renderer/src/main.tsx]] and emits an `app_opened` event.

Its properties are `app_version` (the Hermes version from `package.json`, fetched over the `get-app-version` IPC — not the runtime version), `electron_version`, `node_version`, and `platform`.

Screen navigation is tracked via `captureScreenView` from [[src/renderer/src/App.tsx#App]], and `captureFeatureUsage` records feature-level events. No chat content, prompts, model responses, file paths, or credentials are ever collected.

## Build & CSP

The `VITE_ANALYTICS_BASE_URL` and `VITE_ANALYTICS_API_KEY` secrets are injected into every `npm run build` step of the release workflow (`.github/workflows/release.yml`).

The Content-Security-Policy in [[src/main/app/start.ts]] and `src/renderer/index.html` allows `connect-src` to reach the analytics host (`https://*.hermesone.org`); the former PostHog `script-src`/`connect-src` allowances were removed.
