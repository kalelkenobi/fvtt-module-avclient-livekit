# Recorder integration Implementation

## Original feature request

maybe it's better UX if we keep the recording button disabled when recording and then, when the gm clicks stop, we ask "Do you want to save this recording or delete it and start fresh?". If the user confirms saving we proceed with the flow of finalizing and asking to download when ready. We should also give the GM the option to delete the recording from the server, immediately after download

since we are changing the UI I want to try and add a little improvement. As of now if the user resizes the A/V camera dock area, their preference is not kept across refreshes or reconnection. It would be great if the are stayed at the size they've adjusted it the last time they were in.

add any relevant tests or check to the plan and if needed add additional documentation. Also update the @AGENTS.md file with any relevant or useful information. Only do it if needed.
Before proceeding summarize the entire plan, going into details of changes so that we know exactly how to proceed with implementation

# Implementation Plan

## A. Features

### A1. Persist Camera Dock Size (UX improvement)
The user can already drag-resize #camera-views (CSS only). The new size never survives a re-render. We will persist it client-side.

### A2. LiveKit Recorder Integration
A GM-only record/stop control in the camera dock that drives the remote livekit-recorder FastAPI service over HTTP + WebSocket.

---

## B. Module Settings (added in src/utils/registerModuleSettings.ts)

| Key | Scope | config | Type | Default | Notes |
|---|---|---|---|---|---|
| recorderUrl | world | true (GM only via restricted) | StringField | "" | Base URL e.g. http://localhost:8090. Trim trailing /. |
| recorderApiToken | world | true (GM only) | StringField | "" | Bearer token. |
| cameraDockSize | client | false | ObjectField | {} | { width?: number, height?: number } |

GM-only visibility is achieved either by setting restricted: true (world settings already require GM to write — for visibility in the form we'll guard by game.user?.isGM when registering, matching the pattern used for devMode/forceTurn which use a conditional config: value).

---

## C. Room Name Format Change

File: src/LiveKitAVClient.ts (lines 216–231)

Replace:
`liveKitConnectionSettings.room = foundry.utils.randomID(32);`

With:
```
const worldId = game.world?.id ?? "world";
liveKitConnectionSettings.room = `${worldId}_${foundry.utils.randomID(32)}`;
```

Same change inside registerModuleSettings.ts resetRoom.onChange handler (line 349).

Sanitization: strip any characters not in [a-zA-Z0-9._-] from worldId to satisfy the recorder's room-name regex; truncate combined string to 200 chars.

Breakout rooms unaffected — verified: LiveKitBreakout.ts:49 independently calls randomID(32) and LiveKitAVClient.ts:233-238 uses breakoutRoom to override this.room before any token call. No code path reads the persistent setting through the breakout flow.

---

## D. New Class: LiveKitRecorder (src/LiveKitRecorder.ts)

Composed onto LiveKitClient similar to trackManager / uiManager.

### State

```
type RecorderState = "idle" | "recording" | "stopping" | "packaging";

class LiveKitRecorder {
  state: RecorderState = "idle";
  activeSessionId: string | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: number | null = null;
  private packagingResolvers = new Map<string, (sessionId: string) => void>();
  constructor(private client: LiveKitClient) {}
}
```

### Public methods

| Method | Purpose |
|---|---|
| isConfigured(): boolean | True iff recorderUrl and recorderApiToken are set. |
| init(): Promise<void> | GM-only. Connects WebSocket, calls checkActiveRecording, updates UI. |
| checkActiveRecording(): Promise<{ active: boolean; sessionId?: string }> | GET /recording/status/{room}. Maps 200 → active+sessionId; 404 → idle. |
| startRecording(): Promise<void> | Builds session ID formatTimestamp(new Date()) → POST /recording/start. Handles 409 by surfacing error. |
| stopRecording(): Promise<void> | POST /recording/stop. Sets state to packaging. Awaits packaging_complete from WS or polls /download/{id} (202 vs 200) as fallback. |
| deleteRecording(sessionId: string): Promise<void> | DELETE /recording/{sessionId}. |
| downloadWav(sessionId: string): Promise<void> | Auth-fetch → Blob → object URL → trigger anchor click. |
| downloadZip(sessionId: string): Promise<void> | Same against /recording/{id}/download-all. |
| dispose(): void | Closes WebSocket, clears timers. Called from LiveKitClient disconnect. |

### Private helpers
- formatTimestamp(d: Date): string → YYYY-MM-DD_HH-mm-ss (sanitized, dashes only)
- authHeaders(): HeadersInit → { Authorization: 'Bearer <token>' }
- httpJson<T>(path, init?) → fetch wrapper with auth + JSON parsing + error logging
- connectWebSocket(): Promise<void> → mints ticket, opens /ws?ticket=..., wires onmessage/onclose, schedules reconnect with exponential backoff capped at 30s
- handleWsEvent(ev: { event, session_id, room, reason? }) → updates state + fires UI refresh
- setState(next): void → updates state, calls client.uiManager.setRecordButtonState(...)

### WebSocket reconnection
- On onclose, reconnect with backoff 1s, 2s, 4s, 8s, 16s, 30s.
- On reconnect, re-issue checkActiveRecording() so state stays consistent.

---

## E. UI Changes (src/LiveKitUIManager.ts)

### E1. Record/Stop buttons

Extend addConnectionButtons(element) (or split into a new addRecorderButtons(element)) — only when:
- game.user?.isGM is true
- client.recorder.isConfigured() is true

Two buttons inserted after the disconnect button:
```
recordButton.className =
  "av-control inline-control toggle icon fa-solid fa-fw fa-circle livekit-control record";
stopButton.className =
  "av-control inline-control toggle icon fa-solid fa-fw fa-stop livekit-control stop hidden";
```

State sync method setRecordButtonState(state: RecorderState) updates classes:

| State | Record button | Stop button |
|---|---|---|
| idle | visible, enabled | hidden |
| recording | visible, disabled, has .recording class (CSS flash) | visible, enabled |
| stopping | hidden | visible, disabled |
| packaging | hidden, disabled | hidden |

After packaging_complete → present a Foundry DialogV2 with three buttons: Download WAV, Download ZIP, Close. After a successful download, follow up with a yes/no dialog: "Delete this recording from the server?".

When the GM presses Stop, show a DialogV2 with three buttons:
- Save → recorder.stopRecording() → wait for packaging → download dialog
- Delete → recorder.stopRecording() then recorder.deleteRecording(sessionId) → idle
- Cancel → no-op

Duplicate-injection guard at line 166 (`querySelector(".livekit-control")`) must be tightened to `.livekit-control.connect, .livekit-control.disconnect` so adding the recorder buttons later doesn't short-circuit insertion.

### E2. Camera dock size persistence

New methods on LiveKitUIManager:

| Method | Purpose |
|---|---|
| applyStoredDockSize(): void | Reads cameraDockSize setting and assigns style.width / style.height to #camera-views. Skips when .minimized. Called from onRenderCameraViews. |
| installDockResizeObserver(): void | Idempotent (this.dockObserver !== null guard). Creates ResizeObserver on #camera-views. Saves offsetWidth/offsetHeight debounced 500ms via foundry.utils.debounce. Only saves dimension matching the current axis (vertical → width, horizontal → height). |
| disposeDockResizeObserver(): void | Disconnects observer (used during teardown). |

Storage shape: `{ width?: number, height?: number }` rather than only one value, since the dock can switch axis (vertical/horizontal) and both pieces of data may be relevant.

---

## F. CSS (public/css/avclient-livekit.css)

Add:

```
/* Recorder controls */
.av-control.livekit-control.record {
  color: #d33;
}
.av-control.livekit-control.record.recording {
  animation: livekit-record-flash 1s infinite ease-in-out;
  pointer-events: none;
  opacity: 0.85;
}
.av-control.livekit-control.stop {
  color: #d33;
}
@keyframes livekit-record-flash {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
```

---

## G. Wiring Changes

src/LiveKitClient.ts
- Add field recorder: LiveKitRecorder initialized in constructor.
- In disconnect/cleanup paths, call this.recorder.dispose().

src/LiveKitAVClient.ts
- Apply room name format change (Section C).
- After connect() resolves, if GM, fire client.recorder.init() (don't await — let it run async).

src/utils/hooks.ts
- No new hooks required. The existing renderCameraViews hook already calls into uiManager.onRenderCameraViews, which will now also apply dock size + record buttons.

types/avclient-livekit.d.ts
Add to the SettingConfig augmentation:

```
"avclient-livekit.recorderUrl": string;
"avclient-livekit.recorderApiToken": string;
"avclient-livekit.cameraDockSize": { width?: number; height?: number };
```

Add a small RecorderManifest interface for typed recorder responses.

#### Localization
Add the following keys to `public/lang/{en,es,pl}.json` (English source, leave es/pl with English fallback for now and flag for translation):

- LIVEKITAVCLIENT.recorderUrl / recorderUrlHint
- LIVEKITAVCLIENT.recorderApiToken / recorderApiTokenHint
- LIVEKITAVCLIENT.recordStart
- LIVEKITAVCLIENT.recordStop
- LIVEKITAVCLIENT.recordingInProgress
- LIVEKITAVCLIENT.stopDialogTitle / stopDialogContent
- LIVEKITAVCLIENT.stopDialogSave / stopDialogDelete / stopDialogCancel
- LIVEKITAVCLIENT.downloadDialogTitle / downloadDialogContent
- LIVEKITAVCLIENT.downloadWav / downloadZip
- LIVEKITAVCLIENT.deleteAfterDownloadTitle / deleteAfterDownloadContent
- LIVEKITAVCLIENT.recorderError* (one per error path)

---

## H. Tests / Validation
The repo has no test framework today (per AGENTS.md line 30). Rather than introducing one for this feature, we add lightweight runtime checks + manual QA scripts:

### H1. Static validation (must pass before merging)
- `pnpm run build` succeeds (TypeScript strict mode catches type errors)
- `npx eslint .` clean (no no-console violations — all logging via Logger)

### H2. Manual QA checklist (added to docs/CONTRIBUTING.md under a new "Recorder QA" section)

1. Recorder unconfigured → no record button appears in camera dock.
2. Recorder configured, non-GM user → no record button.
3. Recorder configured, GM → record button visible.
4. Click record → button flashes + disabled, stop button appears, session created on server with ID matching YYYY-MM-DD_HH-mm-ss.
5. Refresh browser while recording → on reconnect, UI resumes recording state without prompting.
6. Reset Room while no recording → succeeds, new room id has format [worldId]_[uuid].
7. Stop → Save → wait for packaging → WAV download dialog appears → download succeeds.
8. Stop → Delete → session deleted on server, UI returns to idle.
9. Stop → Cancel → recording continues.
10. After WAV download, choose "Delete from server" → DELETE succeeds.
11. Drag camera dock taller, refresh page → dock retains height.
12. Switch dock from vertical → horizontal → resize → refresh → correct axis preserved.
13. Breakout flow still works (room name change does not break breakouts).
14. Disconnect WebSocket (kill server briefly) → recorder reconnects with backoff.

### H3. Defensive runtime checks added in code
- LiveKitRecorder.startRecording validates recorderUrl is non-empty before fetch.
- formatTimestamp asserts result matches /^[A-Za-z0-9._-]+$/.
- All recorder fetches wrap in try/catch with Logger.error + ui.notifications?.error for user feedback.
- applyStoredDockSize ignores stored values that fall below the CSS min (250×175) to avoid unusable sizes.

---

## I. Documentation Updates

docs/ARCHITECTURE.md
Add:
- New row in Core Modules table: LiveKitRecorder — recorder integration manager.
- New "Session Recording" section with sequence diagram (start → record → stop → packaging → download → optional delete) and WS reconnection behavior.
- Update settings table to include recorderUrl, recorderApiToken, cameraDockSize.
- Update room-name section: room is now [worldId]_[randomID(32)] for stability.
- Note the camera dock size persistence behavior.

docs/API.md
Add:
- LiveKitRecorder public surface (table of methods listed in Section D).
- Settings reference rows for the three new settings.
- Mention that client._liveKitClient.recorder is the access point, mirroring trackManager / uiManager.

docs/CONTRIBUTING.md
Add:
- "Recorder QA" subsection with the manual checklist from H2.
- Note about needing a running livekit-recorder instance for end-to-end testing.

AGENTS.md
Updates needed:
1. Core Classes table — add row:
   LiveKitRecorder | LiveKitRecorder.ts | Remote livekit-recorder integration (HTTP + WS)
2. Type Definitions — note new RecorderManifest and RecorderState types.
3. A new short subsection "Recorder Integration" under Architecture, briefly listing:
   - Settings: recorderUrl, recorderApiToken, cameraDockSize
   - Room name format: [worldId]_[randomID(32)]
   - GM-only UI; respects useExternalAV
4. Testing note — clarify that the recorder feature has only manual QA; reference the checklist in docs/CONTRIBUTING.md.

---

## J. Order of Implementation
1. Settings + types + localization keys (foundation, no behavior yet).
2. Room name format change (smallest, isolated risk).
3. LiveKitRecorder class (HTTP only, no UI yet — can be unit-exercised manually via console).
4. WebSocket logic with reconnect.
5. LiveKitUIManager recorder buttons + state sync + dialogs.
6. CSS for flashing animation.
7. Camera dock size persistence (independent — can be done in parallel).
8. Wire everything: LiveKitClient exposes recorder, LiveKitAVClient.connect() calls recorder.init().
9. Documentation + AGENTS.md updates.
10. Manual QA pass against checklist H2.

---

## K. Risk Notes / Edge Cases Handled
- Connect race: recorder.init() triggered after Foundry connection completes; if WS fails, recording features still usable via HTTP polling fallback.
- Stop while packaging is slow: UI shows "packaging..." indicator; download dialog only appears after packaging_complete (or fallback poll).
- GM disconnect while packaging: when GM reconnects, checkActiveRecording returns 404 (no active recording), but the session still exists and could be retrieved via /recordings. Out of scope for this iteration; we surface only active sessions per the user's spec.
- Auth token leakage: never put token in URL — always Authorization header. Downloads use fetch + blob.
- CORS: recorder service must allow the Foundry origin. Documented in docs/CONTRIBUTING.md.
- Setting visibility: recorderUrl/recorderApiToken shown only when current user is GM (conditional config: in registration, matching forceTurn pattern).

# Implementation TODO and state
- [✓] Add localization strings to en/es/pl.json
- [✓] Update types/avclient-livekit.d.ts with new settings types
- [x] Add new settings (recorderUrl, recorderApiToken, cameraDockSize) to registerModuleSettings.ts
- [x] Change room name format to [worldId]_[uuid] in LiveKitAVClient.ts and resetRoom handler
- [x] Create new LiveKitRecorder.ts class
- [x] Update LiveKitClient.ts to hold recorder instance
- [x] Update LiveKitUIManager.ts: record/stop buttons + dock size persistence
- [x] Add CSS for record button flashing animation
- [x] Wire recorder init in LiveKitAVClient.connect()
- [x] Fix ESLint errors across all files
- [x] Verify build + eslint pass
- [x] Update docs (ARCHITECTURE.md, API.md, CONTRIBUTING.md, AGENTS.md)

# Key additions to the plan file:
1. Updated TODO section — all code items are now [x] completed except:
   - Fix ESLint errors
   - Verify build passes
   - Update docs
2. Known Issues table with exact line numbers and fixes:
   - Recorder.ts: Remove as string casts, wrap response.status in String(), remove !! on boolean, remove unnecessary ??/?., fix void arrow shorthand
   - UIManager.ts: Same template literal fixes, DialogV2 type casts, void arrow fix
   - registerModuleSettings.ts: Remove ?? false on 12 settings, remove ?. on recorder
   - AVClient.ts: Remove ?. on uiManager
3. Quick Resume Checklist for when you return:
   - Run npx eslint --fix . first
   - Fix remaining template literal/optional chain issues
   - Verify with pnpm run build and npx eslint .
   - Update docs
   - Run manual QA
