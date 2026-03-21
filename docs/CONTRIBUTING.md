# Contributing

This guide covers everything you need to set up a local development environment, build the module, and contribute to the **LiveKit AVClient** module for FoundryVTT.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 18+ | LTS recommended |
| [pnpm](https://pnpm.io/) | 10.28+ | Specified via `packageManager` in `package.json`; install with `corepack enable` |
| [FoundryVTT](https://foundryvtt.com/) | v13+ | Running locally on port 30000 |
| [just](https://github.com/casey/just) | Latest | Optional — provides convenience commands |

---

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/kalelkenobi/fvtt-module-avclient-livekit.git
cd fvtt-module-avclient-livekit
pnpm install
```

### 2. Development Server

The dev server runs on port **30001** and proxies all non-module requests to your local Foundry instance on port 30000:

```bash
pnpm run dev
```

Navigate to `https://localhost:30001` instead of your normal Foundry URL. The dev server provides:
- **Hot Module Replacement (HMR)** for source changes
- **SSL** via `@vitejs/plugin-basic-ssl` (self-signed certificate)
- **ESLint + TypeScript checking** in real-time via `vite-plugin-checker`
- **Automatic public file sync** — changes to `public/` are copied to `dist/` and trigger a full reload

> **Note:** Your Foundry instance must be running on `http://localhost:30000` for the proxy to work.

### 3. Build for Production

```bash
pnpm run build
```

Output goes to `dist/`. The build produces:
- `avclient-livekit.js` — bundled ES module
- `avclient-livekit.js.map` — source map
- Copied static files: `module.json`, `README.md`, `CHANGELOG.md`, `LICENSE*`
- Contents of `public/` (CSS, lang files, templates)

### 4. Development Build

```bash
pnpm run build:dev
```

Same as production but without minification for easier debugging.

### 5. Watch Mode

```bash
pnpm run watch          # development mode
pnpm run watch:prod     # production mode
```

Rebuilds on file changes. Useful when you want to test against Foundry directly without the dev server proxy.

---

## Using `just` Commands

If you have [`just`](https://github.com/casey/just) installed, these convenience recipes are available:

| Command | Description |
|---------|-------------|
| `just` | Default: `reset` → `build-dev` → `dev` |
| `just build` | Production build |
| `just build-dev` | Development build |
| `just dev` | Start dev server |
| `just serve-prod` | Start dev server in production mode |
| `just watch` | Watch mode |
| `just clean` | Remove `dist/` |
| `just clean-deep` | Remove `dist/` and `node_modules/` |
| `just reset` | Deep clean + `pnpm install` |

---

## Project Structure

```
fvtt-module-avclient-livekit/
├── src/                        # TypeScript source code
│   ├── avclient-livekit.ts     # Entry point
│   ├── LiveKitAVClient.ts      # AVClient implementation (Foundry interface)
│   ├── LiveKitClient.ts        # Core LiveKit orchestrator
│   ├── LiveKitTrackManager.ts  # Media stream integration
│   ├── LiveKitUIManager.ts     # DOM injection integration
│   ├── LiveKitAVConfig.ts      # Custom settings UI
│   ├── LiveKitBreakout.ts      # Breakout room functionality
│   └── utils/                  # Utility modules
│       ├── auth.ts             # JWT token generation
│       ├── constants.ts        # Module-wide constants
│       ├── helpers.ts          # General-purpose helpers
│       ├── hooks.ts            # Foundry hook registrations
│       ├── logger.ts           # Logging wrapper (debug library)
│       └── registerModuleSettings.ts  # Module settings registration
├── public/                     # Static assets (copied to dist)
│   ├── css/                    # Stylesheets
│   ├── lang/                   # i18n JSON files (en, es, pl)
│   └── templates/              # Handlebars templates
├── types/                      # TypeScript type declarations
│   └── avclient-livekit.d.ts   # Module interfaces and global augmentations
├── module.json                 # FoundryVTT module manifest
├── vite.config.ts              # Vite build configuration
├── tsconfig.json               # TypeScript configuration
├── eslint.config.mjs           # ESLint flat config
├── package.json                # Dependencies and scripts
└── justfile                    # just command runner recipes
```

---

## Code Quality

### Linting

The project uses ESLint with strict TypeScript rules:

```bash
npx eslint .
```

The configuration (`eslint.config.mjs`) includes:
- `@eslint/js` recommended rules
- `typescript-eslint` strict + stylistic type-checked rules
- `no-console` warning (use the `Logger` class instead)

### TypeScript

Strict mode is enabled with additional checks:

- `noUnusedLocals` / `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `noUncheckedSideEffectImports`
- Target: ESNext with bundler module resolution

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `livekit-client` | LiveKit JavaScript/TypeScript client SDK |
| `jose` | JWT creation and signing (browser-compatible) |
| `debug` | Namespaced debug logging |
| `fvtt-types` | TypeScript type definitions for FoundryVTT |

---


## Adding Translations

1. Create a new JSON file in `public/lang/` (e.g., `fr.json`).
2. Copy the structure from `en.json` and translate the values.
3. Register the language in `module.json`:
   ```json
   {
     "lang": "fr",
     "name": "Français",
     "path": "lang/fr.json"
   }
   ```

---

## Debugging

### Enable Debug Logging

In Foundry module settings, enable **"Enable debug logging"**. This activates the `debug` library's namespaced loggers at the `DEBUG`, `INFO`, `WARN`, and `ERROR` levels.

### Enable Trace Logging

After enabling debug logging, the **"Enable LiveKit trace logging"** option becomes available. This enables all `debug` namespaces including the LiveKit SDK's internal logs.

### Browser Console

Once debug logging is enabled, logs use the `debug` library's namespace format:

```
avclient-livekit:DEBUG message...
avclient-livekit:INFO:LiveKitBreakout message...
avclient-livekit:WARN:LiveKitAVConfig message...
```

### Useful Debug Commands

From the browser console:

```javascript
// Get user connection statistics
game.webrtc.client._liveKitClient.getUserStatistics("userId");

// Get all connected users' statistics
game.webrtc.client._liveKitClient.getAllUserStatistics();

// Start screen sharing (unsupported debug feature)
game.webrtc.client._liveKitClient.shareScreen(true);

// Send a socket command to all users
game.socket.emit("module.avclient-livekit", { action: "render" });
```

---

## Release Process

The project uses a GitHub Actions workflow for releases. The CI pipeline builds the module and creates a GitHub release with the `fvtt-module-avclient-livekit.zip` distribution archive.

---

## Coding Conventions

- **Logging:** Never use `console.*` directly. Use the `Logger` class from `utils/logger.ts`.
- **Settings:** All module settings are registered in `utils/registerModuleSettings.ts` with proper types in `types/avclient-livekit.d.ts`.
- **Localization:** All user-facing strings must use the `LIVEKITAVCLIENT.*` namespace and be added to all language files.
- **Error handling:** Catch and log errors using the `Logger` class. Don't swallow errors silently.
- **Debouncing:** Use the debounce helpers from `utils/helpers.ts` for UI-related operations.
