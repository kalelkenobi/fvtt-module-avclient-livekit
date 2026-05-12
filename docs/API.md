# API Reference

This document covers the public API surface of the LiveKit AVClient module — hooks for integrating from other modules, socket events, configuration settings, and the server type extension API.

---

## Hooks

The module fires and listens to several FoundryVTT hooks.

### Hooks Fired by the Module

#### `liveKitClientInitialized`

Fired after `LiveKitAVClient.initialize()` completes — the `LiveKitClient` instance is fully constructed, local tracks have been initialized, and the client is ready to connect.

```javascript
Hooks.on("liveKitClientInitialized", (liveKitClient) => {
  // liveKitClient: LiveKitClient instance
  // Local tracks are ready; the room connection has not yet been established.
  console.log("LiveKit client initialized:", liveKitClient);
});
```

### Hooks Consumed by the Module

| Hook                    | Handler                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `init`                  | Overrides voice modes, registers module settings                            |
| `ready`                 | Sets up socket listener, overrides WebRTC settings menu                     |
| `renderCameraViews`     | Injects connection quality indicators, custom controls, and volume handlers |
| `getUserContextOptions` | Adds breakout room context menu entries                                     |

---

## Socket Events

The module communicates between clients via FoundryVTT's socket system on the `module.avclient-livekit` channel.

### Message Format

```typescript
interface SocketMessage {
  action: "breakout" | "connect" | "disconnect" | "render";
  userId?: string;
  breakoutRoom?: string;
}
```

### Actions

#### `breakout`

Instructs a user to join or leave a breakout room. Only accepted when the sender is a GM.

```javascript
// Assign a user to a breakout room (GM only, targeted)
game.socket.emit(
  "module.avclient-livekit",
  { action: "breakout", userId: "targetUserId", breakoutRoom: "roomId" },
  { recipients: ["targetUserId"] },
);

// Remove a user from their breakout room
game.socket.emit(
  "module.avclient-livekit",
  { action: "breakout", userId: "targetUserId", breakoutRoom: undefined },
  { recipients: ["targetUserId"] },
);

// End all breakouts (broadcast)
game.socket.emit("module.avclient-livekit", {
  action: "breakout",
  userId: undefined,
  breakoutRoom: undefined,
});
```

#### `connect`

Commands all clients to reconnect to the LiveKit server. Only accepted when sent by a GM.

```javascript
game.socket.emit("module.avclient-livekit", { action: "connect" });
```

#### `disconnect`

Commands all clients to disconnect from the LiveKit server. Only accepted when sent by a GM.

```javascript
game.socket.emit("module.avclient-livekit", { action: "disconnect" });
```

#### `render`

Commands all clients to re-render their camera views. Only accepted when sent by a GM.

```javascript
game.socket.emit("module.avclient-livekit", { action: "render" });
```

---

## Module Settings

All settings are accessible via `game.settings.get("avclient-livekit", key)`.

### Client-Scoped Settings

| Key                            | Type      | Default       | Description                                                                          |
| ------------------------------ | --------- | ------------- | ------------------------------------------------------------------------------------ |
| `secondaryAudioSrc`            | `string`  | `"disabled"`  | Secondary mic device id, or `"disabled"` to use only the primary source             |
| `videoResolution`              | `string`  | `"4x3_h1080"` | Camera resolution from LiveKit presets, e.g. `16x9_h720`; simulcast is auto-derived |
| `autoConnect`                  | `boolean` | `true`        | Auto-connect to the LiveKit server on world load                                     |
| `displayConnectionQuality`     | `boolean` | `true`        | Show connection quality indicator on camera views                                    |
| `breakoutRoomRegistry`         | `object`  | `{}`          | Mapping of user IDs to breakout room IDs                                             |
| `useExternalAV`                | `boolean` | `false`       | Open A/V in a separate browser window/device                                         |
| `advancedSettingsMode`         | `boolean` | `false`       | Reveal advanced audio/video settings                                                 |
| `primaryAudioGain`             | `number`  | `100`         | Primary-source gain % (0–200); visible when secondary source is active               |
| `secondaryAudioGain`           | `number`  | `100`         | Secondary-source gain % (0–200); visible when secondary source is active             |
| `advancedSettingsTargetSource` | `string`  | `"both"`      | Which source advanced options apply to: `"both"` / `"primary"` / `"secondary"`      |
| `autoGainControl`              | `boolean` | `true`        | Automatic gain control on audio capture (advanced mode)                              |
| `echoCancellation`             | `boolean` | `true`        | Echo cancellation on audio capture (advanced mode)                                   |
| `noiseSuppression`             | `boolean` | `true`        | Noise suppression on audio capture (advanced mode)                                   |
| `voiceIsolation`               | `boolean` | `true`        | Voice isolation on audio capture (advanced mode)                                     |
| `audioBitRate`                 | `number`  | `128`         | Opus encoding bitrate in kbps, 8–510 step 8 (advanced mode)                         |
| `dtx`                          | `boolean` | `true`        | Opus discontinuous transmission (advanced mode)                                      |
| `red`                          | `boolean` | `true`        | Redundant audio data encoding (advanced mode)                                        |
| `videoCodec`                   | `string`  | `"vp9"`       | Primary video codec: `vp8` / `vp9` / `av1` / `h264` / `h265` (advanced mode)       |
| `backupCodec`                  | `string`  | `"vp8"`       | Backup video codec: `vp8` / `h264` (advanced mode)                                  |

### World-Scoped Settings

| Key                          | Type      | Default | Description                                         |
| ---------------------------- | --------- | ------- | --------------------------------------------------- |
| `liveKitConnectionSettings`  | `object`  | `{}`    | Server URL, room ID, API key, secret key            |
| `resetRoom`                  | `boolean` | `false` | Trigger to generate a new meeting room ID (GM only) |
| `recorderConnectionSettings` | `object`  | `{}`    | Recorder service URL and API token (Server tab)     |
| `debug`                      | `boolean` | `false` | Enable debug-level logging                          |
| `liveKitTrace`               | `boolean` | `false` | Enable LiveKit SDK trace-level logging              |
| `devMode`                    | `boolean` | `false` | Expose developer-only settings                      |
| `forceTurn`                  | `boolean` | `false` | Force TURN relay connections (dev mode only)        |

### Connection Settings Object

```typescript
interface LiveKitConnectionSettings {
  url?: string;      // LiveKit server WebSocket URL
  room?: string;     // Meeting room ID (auto-generated)
  username?: string; // API key
  password?: string; // Secret key
}
```

### Recorder Connection Settings Object

```typescript
interface RecorderConnectionSettings {
  url?: string;      // Recorder service base URL
  apiToken?: string; // Bearer token for recorder API authentication
}
```

---

## LiveKitClient Public Properties

When accessed via `game.webrtc.client._liveKitClient`:

| Property                | Type                      | Description                                        |
| ----------------------- | ------------------------- | -------------------------------------------------- |
| `avMaster`              | `foundry.av.AVMaster`     | Reference to Foundry's A/V master instance         |
| `liveKitAvClient`       | `LiveKitAVClient`         | Reference to the AVClient implementation           |
| `settings`              | `foundry.av.AVSettings`   | Reference to A/V settings                          |
| `liveKitRoom`           | `Room \| null`            | The LiveKit Room object                            |
| `liveKitParticipants`   | `Map<string, Participant>`| Map of FVTT user ID → LiveKit Participant           |
| `connectionState`       | `ConnectionState`         | Current LiveKit connection state                   |
| `initState`             | `InitState`               | Initialization state: `Uninitialized` / `Initializing` / `Initialized` |
| `audioBroadcastEnabled` | `boolean`                 | Whether audio is being broadcast                   |
| `breakoutRoom`          | `string \| undefined`     | Current breakout room ID                           |
| `useExternalAV`         | `boolean`                 | Whether external A/V mode is active                |
| `trackManager`          | `LiveKitTrackManager`     | Manager for audio/video tracks (see below)         |
| `uiManager`             | `LiveKitUIManager`        | Manager for UI elements (see below)                |
| `recorder`              | `LiveKitRecorder`         | Manager for recorder integration (GM-only)         |

---

## LiveKitClient Public Methods

| Method                              | Returns               | Description                                      |
| ----------------------------------- | --------------------- | ------------------------------------------------ |
| `getUserStatistics(userId)`         | `string`              | Get connection bitrate statistics for a user     |
| `getAllUserStatistics()`            | `Map<string, string>` | Get statistics for all connected users           |
| `getParticipantFVTTUser(participant)` | `User \| undefined` | Resolve a LiveKit Participant to a Foundry User  |
| `getParticipantUseExternalAV(participant)` | `boolean`     | Check if a participant is using the external client |

---

## LiveKitTrackManager

Access via `game.webrtc.client._liveKitClient.trackManager`:

### Properties

| Property              | Type                      | Description                                        |
| --------------------- | ------------------------- | -------------------------------------------------- |
| `audioTrack`          | `LocalAudioTrack \| null` | The active local audio track (may be a mixed track)|
| `primaryAudioTrack`   | `LocalAudioTrack \| null` | Primary microphone track                           |
| `secondaryAudioTrack` | `LocalAudioTrack \| null` | Secondary microphone track (if configured)         |
| `videoTrack`          | `LocalVideoTrack \| null` | The local video track                              |
| `screenTracks`        | `LocalTrack[]`            | Active screen sharing tracks                       |
| `audioContext`        | `AudioContext \| null`    | Web Audio context used for mixing multiple sources |
| `mixedMediaStream`    | `MediaStream \| null`     | Combined audio stream when mixing two sources      |

### Methods

| Method                                                      | Returns                                        | Description                                  |
| ----------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `initializeLocalTracks()`                                   | `Promise<void>`                                | Initialize local audio/video tracks          |
| `changeAudioSource(forceStop?)`                             | `Promise<void>`                                | Switch the audio input device                |
| `changeVideoSource()`                                       | `Promise<void>`                                | Switch the video input device                |
| `setAudioEnabledState(enable)`                              | `void`                                         | Enable or disable the local audio track      |
| `shareScreen(enabled)`                                      | `Promise<void>`                                | Start or stop screen sharing                 |
| `getUserAudioTrack(userId)`                                 | `LocalAudioTrack \| RemoteAudioTrack \| undefined` | Get a user's audio track                 |
| `getUserVideoTrack(userId)`                                 | `LocalVideoTrack \| RemoteVideoTrack \| undefined` | Get a user's video track                 |
| `attachAudioTrack(userId, userAudioTrack, audioElement)`    | `Promise<void>`                                | Attach an audio track to an audio element    |
| `attachVideoTrack(userVideoTrack, videoElement)`            | `void`                                         | Attach a video track to a video element      |
| `setPrimaryGain(percent)`                                   | `void`                                         | Set primary-source gain (0–200)              |
| `setSecondaryGain(percent)`                                 | `void`                                         | Set secondary-source gain (0–200)            |

---

## LiveKitUIManager

Access via `game.webrtc.client._liveKitClient.uiManager`:

### Methods

| Method                                                    | Returns                    | Description                              |
| --------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| `onGetUserContextOptions(playersElement, contextOptions)` | `void`                     | Add breakout room context menu options   |
| `onRenderCameraViews(cameraViews, html)`                  | `void`                     | Main render hook — injects all UI elements |
| `addConnectionButtons(element)`                           | `void`                     | Add LiveKit control buttons to UI        |
| `setConnectionButtons(connected)`                         | `void`                     | Update button states based on connection |
| `addConnectionQualityIndicator(userId)`                   | `void`                     | Add quality indicator dot to camera view |
| `addRecorderButtons(element)`                             | `void`                     | Inject record/stop buttons (GM only)     |
| `setRecordButtonState(state, sessionId)`                  | `void`                     | Sync record/stop button visibility       |
| `getUserAudioElement(userId, videoElement, audioType)`    | `HTMLAudioElement \| null` | Get or create audio element for user     |
| `onIsSpeakingChanged(userId, speaking)`                   | `void`                     | Update speaking indicator for a user     |
| `onConnectionQualityChanged(quality, participant)`        | `void`                     | Update quality indicator for a participant |
| `onAudioPlaybackStatusChanged(canPlayback)`               | `void`                     | Handle browser autoplay policy changes   |

---

## LiveKitRecorder

Access via `game.webrtc.client._liveKitClient.recorder`:

### Properties

| Property          | Type             | Description                             |
| ----------------- | ---------------- | --------------------------------------- |
| `state`           | `RecorderState`  | Current state: `idle` / `recording` / `stopping` |
| `activeSessionId` | `string \| null` | Currently active session ID or null     |

### Methods

| Method                      | Returns                          | Description                                        |
| --------------------------- | -------------------------------- | -------------------------------------------------- |
| `isConfigured()`            | `boolean`                        | True iff recorder URL and API token are both set   |
| `getUrl()`                  | `string`                         | Recorder base URL (trimmed)                        |
| `getToken()`                | `string`                         | Configured bearer token (trimmed)                  |
| `reconfigure()`             | `Promise<void>`                  | Tear down WS, re-init if configured                |
| `init()`                    | `Promise<void>`                  | Check active recording, connect WebSocket          |
| `checkActiveRecording()`    | `Promise<{active, sessionId?}>`  | GET /recording/status/{room}                       |
| `startRecording()`          | `Promise<string \| null>`        | Start recording, returns session ID                |
| `stopRecording()`           | `Promise<void>`                  | Stop recording                                     |
| `deleteRecording(sessionId)`| `Promise<void>`                  | DELETE recording from server                       |
| `downloadZip(sessionId)`    | `Promise<void>`                  | Download ZIP containing per-participant Opus files |
| `dispose()`                 | `void`                           | Close WS, clear timers                             |

**WebSocket auth:** Before connecting the WebSocket, `init()` calls `POST /ws-ticket` with the bearer token to obtain a short-lived ticket. The ticket is appended as a query parameter to the WS URL, so the bearer token never travels over the WS handshake URL. On disconnect, reconnection uses exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap).

---

## CSS Classes

These CSS classes are added to camera view elements and can be targeted for custom styling:

| Class                                     | Element   | Description                           |
| ----------------------------------------- | --------- | ------------------------------------- |
| `.connection-quality-indicator`           | `<div>`   | Connection quality dot container      |
| `.connection-quality-indicator.excellent` | `<div>`   | Green dot — excellent connection      |
| `.connection-quality-indicator.good`      | `<div>`   | Yellow dot — good connection          |
| `.connection-quality-indicator.poor`      | `<div>`   | Red dot — poor connection             |
| `.connection-quality-indicator.unknown`   | `<div>`   | Grey dot — unknown quality            |
| `.livekit-control`                        | `button`  | Custom LiveKit control button         |
| `.livekit-control.hidden`                 | `button`  | Hidden control (display: none)        |
| `.livekit-control.disabled`               | `button`  | Disabled control (no pointer events)  |
| `.livekit-control.record`                 | `button`  | Record button (red circle)            |
| `.livekit-control.record.recording`       | `button`  | Active recording (pulsing animation)  |
| `.livekit-control.record-stop`            | `button`  | Stop button (shown while recording)   |
| `.status-remote-hidden`                   | `<i>`     | Icon for remotely hidden users        |
| `.status-remote-muted`                    | `<i>`     | Icon for remotely muted users         |
| `.status-remote-ptt`                      | `<i>`     | Push-to-talk status indicator         |
| `.status-remote-ptt.active`               | `<i>`     | Active push-to-talk (green)           |
| `.local-camera`                           | `<video>` | Mirrored local camera view            |
