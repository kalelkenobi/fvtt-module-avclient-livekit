# AGENTS.md

Guidelines for AI agents working in the **LiveKit AVClient** module for FoundryVTT.

## Project Overview

This module replaces FoundryVTT's native WebRTC A/V system with [LiveKit](https://livekit.io/), a Selective Forwarding Unit (SFU)-based real-time communication platform. Built with TypeScript, Vite, and ES modules.

## Build & Lint Commands

```bash
pnpm install            # Install dependencies
pnpm run build          # Production build → dist/
pnpm run build:dev      # Development build (no minification)
pnpm run dev            # Dev server on :30001, proxies to Foundry :30000
pnpm run watch          # Watch mode (development)
pnpm run watch:prod     # Watch mode (production)
npx eslint .            # Lint with strict TypeScript rules
```

**Justfile shortcuts** (if `just` is installed):

```bash
just build              # Production build
just build-dev          # Development build
just dev                # Start dev server
just reset              # Deep clean + pnpm install
```

**Note:** No test framework is configured. Validation is done via TypeScript compilation and ESLint.

## Architecture

### Entry Point

`src/avclient-livekit.ts` → Sets `CONFIG.WebRTC.clientClass = LiveKitAVClient`

### Core Classes

| Class                 | File                     | Role                                                                    |
| --------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `LiveKitAVClient`     | `LiveKitAVClient.ts`     | Foundry AVClient interface (lifecycle, device enumeration, track state) |
| `LiveKitClient`       | `LiveKitClient.ts`       | Core orchestrator (Room management, participants, socket events)        |
| `LiveKitTrackManager` | `LiveKitTrackManager.ts` | Media streams (local/remote tracks, mixing, screen share)               |
| `LiveKitUIManager`    | `LiveKitUIManager.ts`    | DOM injection (connection quality indicators, volume sliders)           |
| `LiveKitAVConfig`     | `LiveKitAVConfig.ts`     | Custom A/V settings UI                                                  |
| `LiveKitRecorder`     | `LiveKitRecorder.ts`     | Remote livekit-recorder integration (HTTP + WebSocket)                    |
| `LiveKitBreakout`     | `LiveKitBreakout.ts`     | Breakout room functionality                                             |

### Utilities (`src/utils/`)

| File                        | Purpose                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `auth.ts`                   | JWT token generation using `jose` library                                          |
| `hooks.ts`                  | Foundry hook registrations (init, ready, renderCameraViews, getUserContextOptions) |
| `logger.ts`                 | Namespaced logging wrapper using `debug` library                                   |
| `helpers.ts`                | `buildRoomName()`, `formatRecorderTimestamp()`, debounce helpers (`delayReload()`, `debounceRefreshView()`, `callWhenReady()`) |
| `registerModuleSettings.ts` | Module settings registration                                                       |
| `constants.ts`              | `MODULE_NAME = "avclient-livekit"`, `LANG_NAME = "LIVEKITAVCLIENT"`                |

### Type Definitions

`types/avclient-livekit.d.ts` contains:

- `LiveKitConnectionSettings` interface
- `SocketMessage` interface
- `RecorderState`, `RecorderRoomStatus`, `RecorderActionResponse`, `RecorderWsEvent` types
- Global augmentations for `SettingConfig`

### Recorder Integration

`LiveKitRecorder` is composed onto `LiveKitClient` (accessed via `game.webrtc.client._liveKitClient.recorder`):

- **Settings:** `recorderConnectionSettings` (world-scoped, configured via the AV config Server tab)
- **State machine:** `idle` → `recording` → `stopping` → `idle`
- **WebSocket:** Long-lived connection for real-time state updates (`recording_started`, `recording_stopped`, plus mix events logged but unused), with exponential backoff reconnection (1s–30s)
- **HTTP API:** `start`, `stop`, `delete`, `status`, and `download` (ZIP) via auth headers
- **No polling fallback:** All state flows through the WebSocket; stop finalises inline (no async packaging step)
- **UI:** A single record-toggle button is injected into the GM's camera dock; its icon and state classes (idle → record circle, recording → stop icon with pulse animation, stopping → spinner) are driven by recorder state. Stop prompt offers Save/Delete/Cancel; download prompt offers ZIP/Close + optional delete-after-download.
- **Room name format:** `[worldId]_[randomID(32)]` — used consistently across connect and reset flows
- **Camera dock size persistence:** Vertical dock width is written to Foundry's built-in `client.dockWidth` setting via `ResizeObserver`. Horizontal dock height is persisted in `cameraDockHeight` and re-applied after each render via `requestAnimationFrame` + `MutationObserver` to resist Foundry's own dimension apply.

**Testing:** No test framework. Validation is via TypeScript compilation, ESLint, and manual QA (checklist in `docs/CONTRIBUTING.md`).

## Implementation Plan Convention

For any non-trivial change (multi-file, new feature, significant refactor), create a
plan document **before** writing code. Trivial fixes (single-line, typo, simple config)
do not need a plan.

### Plan File

- **Location:** `.opencode/plans/PLAN-<short-slug>.md`
- **Git-ignored:** Yes (`.opencode/` is already in `.gitignore`)

### Plan File Format

```markdown
# Plan: <brief title>
**Created:** YYYY-MM-DD
**Status:** in-progress

## Overview
<what is being done and why — 2-4 sentences>

## Changes
Detailed file-by-file breakdown of what needs to change and how.

### `src/<FileA>.ts`
- **Lines L1-L40:** <what to change and why>
- **Line L15:** Change `foo` to `bar` to fix <reason>
- **After line L30:** Add new method `handleX()` that <purpose>

### `src/<FileB>.ts`
- **Lines L50-L80:** <description of change>
- ...

### `types/avclient-livekit.d.ts` (if needed)
- **Line L22:** Add `newField: string` to `SomeInterface`

### `public/lang/en.json` (if needed)
- Add `"LIVEKITAVCLIENT.newKey": "User-facing text"`

## Todo
- [ ] Task 1 — maps to items in Changes above
- [/] Task 2 (in progress)
- [x] Task 3 (done)
```

### During Implementation

- The `todowrite` tool is the **canonical** todo tracker during an active session.
- Sync the plan file's checkbox list to match `todowrite` state at session boundaries
  (before ending or when the agent detects potential interruption).
- On starting a new session, scan `.opencode/plans/` for any `in-progress` plans
  and resume from the last synced state.
- The `Changes` section must be detailed enough (files, line numbers, intent)
  that even a smaller coding model can follow it with minimal mistakes.

### Plan Lifecycle

- **Created** → `Status: in-progress` with initial todo.
- **During work** → Update checkboxes as tasks progress.
- **Completed** → Delete the plan file after the work is verified (build + lint pass).
- **Abandoned** → Set `Status: abandoned` with a brief note explaining why;
  keep the file for future reference.

## Completion Checklist

Every implementation task MUST end with these three steps, in order:

1. **Build:** `pnpm run build` — must pass with zero errors.
2. **Lint:** `npx eslint .` — must pass with zero warnings and zero errors.
3. **Commit:** Create a local git commit with a message following the repo's
   [conventional commit](https://www.conventionalcommits.org/) style:

   ```
   <type>: <brief description in lowercase imperative>
   ```

   Common types: `feat`, `fix`, `refactor`, `chore`, `version`, `docs`.

   Multi-line commits use bullet points for details:
   ```
   feat: add <feature description>
   - Detail point one
   - Detail point two
   ```

   Match the tone and level of detail of existing commits (see `git log --oneline -20`).

   **Do NOT push** unless the user explicitly asks.

## Code Style Guidelines

### Imports

Order: External dependencies → Internal modules → Types

```typescript
// External
import { Room, RoomEvent, ConnectionState } from "livekit-client";

// Internal
import { MODULE_NAME, LANG_NAME } from "./utils/constants";
import LiveKitClient from "./LiveKitClient";
import { Logger } from "./utils/logger";

// Types
import { LiveKitConnectionSettings } from "../types/avclient-livekit";
```

### TypeScript

- **Strict mode** enabled with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Target: ESNext with bundler module resolution
- Define interfaces/types in `types/avclient-livekit.d.ts`
- Use `fvtt-types` for Foundry type definitions
- Prefer explicit return types on public methods

### Naming Conventions

| Element             | Convention           | Example            |
| ------------------- | -------------------- | ------------------ |
| Classes             | PascalCase           | `LiveKitClient`    |
| Class files         | PascalCase           | `LiveKitClient.ts` |
| Utility files       | camelCase            | `helpers.ts`       |
| Constants           | SCREAMING_SNAKE_CASE | `MODULE_NAME`      |
| Variables/functions | camelCase            | `getAccessToken`   |
| Private members     | Underscore prefix    | `_liveKitClient`   |

### Logging (CRITICAL)

**Never use `console.*` directly.** Use the `Logger` class:

```typescript
import { Logger } from "./utils/logger";

const log = new Logger(); // Base namespace: avclient-livekit
const log = new Logger("MyClass"); // Namespace: avclient-livekit:MyClass

log.debug("Debug message");
log.info("Info message");
log.warn("Warning message");
log.error("Error occurred:", error);
log.trace("Trace message"); // Most verbose
```

ESLint enforces this with `no-console: warn`.

### Error Handling

- **Always catch and log errors** with context
- **Never swallow errors silently**
- Use `ui.notifications?.error()` for user-facing errors
- Include localized strings for user messages

```typescript
// Pattern for async operations
await someAsyncOperation().catch((error: unknown) => {
  log.error("Context about what failed:", error);
});

// Pattern for user-facing errors
if (criticalError) {
  log.error("Descriptive error for debugging", errorDetails);
  ui.notifications?.error(game.i18n.localize(`${LANG_NAME}.errorKey`), {
    permanent: true,
  });
  return false;
}
```

### Localization

- All user-facing strings use the `LIVEKITAVCLIENT.*` namespace
- Add translations to all language files: `public/lang/{en,es,pl}.json`
- Access via `game.i18n.localize(\`${LANG_NAME}.keyName\`)`

### Module Settings

1. Register in `src/utils/registerModuleSettings.ts`
2. Define types in `types/avclient-livekit.d.ts` under `SettingConfig`

```typescript
// In registerModuleSettings.ts
game.settings?.register(MODULE_NAME, "settingKey", {
  name: "LIVEKITAVCLIENT.settingName",
  hint: "LIVEKITAVCLIENT.settingHint",
  scope: "client", // or "world"
  config: true,
  default: false,
  type: new foundry.data.fields.BooleanField({ initial: false }),
});
```

### Debouncing

Use `foundry.utils.debounce()` or helpers from `utils/helpers.ts`:

```typescript
import { delayReload, debounceRefreshView } from "./utils/helpers";

// Debounced page reload (100ms)
delayReload();

// Debounced per-user camera view refresh (200ms)
debounceRefreshView(userId);

// Custom debounce
const debouncedFn = foundry.utils.debounce(() => {
  /* ... */
}, 200);
```

## Key Dependencies

| Package          | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `livekit-client` | LiveKit JavaScript/TypeScript SDK             |
| `jose`           | JWT creation and signing (browser-compatible) |
| `debug`          | Namespaced debug logging                      |
| `fvtt-types`     | TypeScript definitions for FoundryVTT         |

## Additional Documentation

- `docs/ARCHITECTURE.md` - Detailed architecture, data flow diagrams, module internals
- `docs/CONTRIBUTING.md` - Development setup, debugging, release process
- `docs/API.md` - Public API documentation

## Documentation Maintenance

**Keep documentation in sync with code changes.** When making changes that affect:

- **Architecture** (new classes, changed responsibilities, removed components) → Update `docs/ARCHITECTURE.md`
- **Public API** (new methods, changed signatures, removed methods) → Update `docs/API.md`
- **Development workflow** (new commands, changed build process) → Update `docs/CONTRIBUTING.md`
- **Module settings** (new settings, changed defaults) → Update `docs/ARCHITECTURE.md` settings table and `docs/API.md` settings section

### What to Update

| Change Type                    | Files to Update                                          |
| ------------------------------ | -------------------------------------------------------- |
| New/removed class              | `AGENTS.md` (Core Classes table), `docs/ARCHITECTURE.md` |
| New/removed utility            | `AGENTS.md` (Utilities table), `docs/ARCHITECTURE.md`    |
| Changed class responsibilities | `docs/ARCHITECTURE.md`                                   |
| New/removed public method      | `docs/API.md`                                            |
| New/removed hook               | `docs/API.md`, `docs/ARCHITECTURE.md`                    |
| New/removed setting            | `docs/ARCHITECTURE.md`, `docs/API.md`                    |
| Changed build/dev commands     | `AGENTS.md`, `docs/CONTRIBUTING.md`                      |

### Documentation Style

- Use tables for listing properties, methods, settings
- Include code examples for non-obvious usage patterns
- Keep descriptions concise but complete
- Update Mermaid diagrams if data flow changes
