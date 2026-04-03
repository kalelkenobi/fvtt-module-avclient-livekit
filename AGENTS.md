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
| `LiveKitBreakout`     | `LiveKitBreakout.ts`     | Breakout room functionality                                             |

### Utilities (`src/utils/`)

| File                        | Purpose                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `auth.ts`                   | JWT token generation using `jose` library                                          |
| `hooks.ts`                  | Foundry hook registrations (init, ready, renderCameraViews, getUserContextOptions) |
| `logger.ts`                 | Namespaced logging wrapper using `debug` library                                   |
| `helpers.ts`                | Debounce utilities: `delayReload()`, `debounceRefreshView()`, `callWhenReady()`    |
| `registerModuleSettings.ts` | Module settings registration                                                       |
| `constants.ts`              | `MODULE_NAME = "avclient-livekit"`, `LANG_NAME = "LIVEKITAVCLIENT"`                |

### Type Definitions

`types/avclient-livekit.d.ts` contains:

- `LiveKitConnectionSettings` interface
- `SocketMessage` interface
- Global augmentations for `SettingConfig`

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
