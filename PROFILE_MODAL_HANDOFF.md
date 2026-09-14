# Profile Modal — Handoff

A global, reusable profile detail/settings modal for Hermes Desktop (Electron + React renderer). Built on branch `pr/746`. This doc is a self-contained handoff so another agent can continue the work.

## What it is

A single **80vw × 80vh** modal, mounted once at the app root, opened from anywhere via a context hook. It has a **left section-nav** (Profile / Wallet / Advanced) and a scrollable right content pane. It replaces the old inline "appearance" modal that used to live inside the Agents screen.

It was built to grow — the user has "more plans with profile" (e.g. a real Wallet screen).

## Files

| File | Role |
| --- | --- |
| `src/renderer/src/components/profile/ProfileModal.tsx` | The modal UI (header, left nav, panes, mutations). |
| `src/renderer/src/components/profile/ProfileModalProvider.tsx` | Mounts the modal at app root; holds open state. |
| `src/renderer/src/components/profile/ProfileModalContext.ts` | Context + `useProfileModal()` hook + `OpenProfileOptions` type. |
| `src/renderer/src/App.tsx` | `<ProfileModalProvider>` wraps the app (inside `FontProvider`). |
| `src/renderer/src/screens/Layout/ProfileSwitcher.tsx` | Sidebar popover; active profile button calls `openProfile`. |
| `src/renderer/src/screens/Agents/Agents.tsx` | Profiles screen; pencil/card edit calls `openProfile` (inline modal removed). |
| `src/renderer/src/assets/main.css` | All `.profile-modal-*` styles (search that prefix). |
| `src/renderer/src/assets/icons/index.tsx` | Re-exports lucide icons; added `User`, `Wallet`. |
| `src/shared/i18n/locales/en/agents.ts` | i18n keys (English source; see i18n note). |
| `lat.md/sidebar-navigation.md` | Architecture doc, section "Profile detail modal" (keep in sync). |

## How to open it

```ts
import { useProfileModal } from "../../components/profile/ProfileModalContext";

const { openProfile } = useProfileModal();

openProfile("fatha", {
  onChanged: reloadMyList,                 // called after every successful mutation
  onDeleted: (name) => { /* e.g. fall back to "default" if it was active */ },
});
```

The modal **self-loads** its data via `window.hermesAPI.listProfiles()` (there is no single-profile IPC) and re-reads after every mutation, so callers only need `onChanged`/`onDeleted` to refresh their own lists.

## Current structure

**Header:** small `ProfileAvatar` (28px) + the profile **name only** (no "Edit {name}") + close (X).

**Left nav** (`PROFILE_SECTIONS` in `ProfileModal.tsx`), each item = icon + label:
- **Profile** (`User` icon) — large avatar + gateway dot, name + `default` tag, Upload/Remove image, the provider/model/skills/gateway chips, and the color swatches.
- **Wallet** (`Wallet` icon) — **placeholder only**: centered "Coming soon" (`.profile-modal-coming-soon`). Not yet implemented.
- **Advanced** (`Settings` icon) — the Delete Profile danger zone.

**Behaviors:**
- Every profile is editable (avatar + color), **including `default`**.
- Only `default` **cannot be deleted** — its Advanced pane shows `agents.defaultNotDeletable` instead of the delete button.
- Dismiss: overlay click, Escape, close (X), or Done button.

## Profile data shape (`listProfiles()`)

```ts
{ name, path, isDefault, isActive, model, provider, hasEnv, hasSoul,
  skillCount, gatewayRunning, color?, avatar? }
```

## IPC available on `window.hermesAPI` (no new IPC was added)

- `listProfiles()` → `ProfileInfo[]`
- `setProfileColor(name, color)` → `{ success, error? }`
- `setProfileAvatar(name, dataUrl)` → `{ success, error? }`
- `removeProfileAvatar(name)` → `{ success, error? }`
- `deleteProfile(name)` → `{ success, error? }`
- `createProfile(name, clone)`, `setActiveProfile(name)` (used elsewhere)

Avatar files are converted with `fileToAvatarDataUrl` (`src/renderer/src/utils/imageResize.ts`). Colors come from `PROFILE_COLORS` (`src/shared/profileColors.ts`).

## How to add a new section (e.g. build out Wallet)

1. Add the id to the `ProfileSection` union and an entry to `PROFILE_SECTIONS` (`{ id, labelKey, Icon }`) in `ProfileModal.tsx`.
2. Add a `{section === "<id>" && (<div className="profile-modal-pane"> … </div>)}` block in the content area.
3. Add the nav label key to `src/shared/i18n/locales/en/agents.ts` (e.g. `sectionWallet`).
4. Style with existing `.profile-modal-*` classes or add new ones in `main.css`.

## Project conventions (important)

- **i18n**: source/fallback locale is `en`. New UI strings go in `src/shared/i18n/locales/en/agents.ts`; the other 10 locales (`es, he, id, ja, pl, pt-BR, pt-PT, tr, zh-CN, zh-TW`) **fall back to en automatically** (`FALLBACK_LOCALE` in `src/shared/i18n/index.ts`), so you don't have to edit them to ship — translate later.
- **lat.md sync (required)**: this repo uses [lat.md]. After any code change, update the relevant section in `lat.md/` and run `lat check` (a Stop hook enforces this). The profile modal is documented in `lat.md/sidebar-navigation.md` → "Profile detail modal". Wiki links like `[[src/.../ProfileModal.tsx#ProfileModal]]` must resolve.
- **Node for tooling**: the repo's `.nvmrc` pins Node 21, but `vitest`/typecheck need **Node ≥22** (`nvm use 22.19.0`) — Node 21 fails to load `vitest.config.ts` (`ERR_REQUIRE_ESM`).
- **react-refresh**: keep hooks/context in `.ts` files separate from the provider component (`.tsx`) — that's why context/hook and provider are split.

## Verify

```bash
nvm use 22.19.0
npm run typecheck:web
npx eslint src/renderer/src/components/profile/*.ts src/renderer/src/components/profile/*.tsx
lat check
```

Manual (`npm run dev`, Node ≥22): sidebar profile popover → click the active profile → modal opens; switch nav sections; edit color/avatar (reflects live in sidebar + Agents); Wallet shows "Coming soon"; Advanced deletes non-default profiles (default shows the not-deletable note).

## Known open items / ideas

- **Wallet** is a stub — needs the real screen + likely new IPC for wallet/balance.
- Advanced currently holds only Delete; the user mentioned "wallet etc. in advanced … add later," so more settings can live there.
- No automated tests yet for `ProfileModal` (the dashboard adapter has tests as a pattern to follow under `src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`).
