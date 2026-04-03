# API Reference

This document covers the public API surface of the LiveKit AVClient module — hooks for integrating from other modules, socket events, configuration settings, and the server type extension API.

---

## Hooks

The module fires and listens to several FoundryVTT hooks.

### Hooks Fired by the Module

#### `liveKitClientAvailable`

Fired when the `LiveKitClient` instance is constructed and available, but before the connection to the LiveKit server has been established.

```javascript
Hooks.on("liveKitClientAvailable", (liveKitClient) => {
  // liveKitClient: LiveKitClient instance
  // Use this to register custom server types or configure the client
  liveKitClient.addLiveKitServerType({ ... });
});
```

#### `liveKitClientInitialized`

Fired after the LiveKit connection has been fully established and local tracks have been published.

```javascript
Hooks.on("liveKitClientInitialized", (liveKitClient) => {
  // liveKitClient: LiveKitClient instance
  // The room is now connected and ready
  console.log("LiveKit room connected:", liveKitClient.liveKitRoom);
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

Instructs a user to join or leave a breakout room.

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

Commands all clients to reconnect to the LiveKit server.

```javascript
game.socket.emit("module.avclient-livekit", { action: "connect" });
```

#### `disconnect`

Commands all clients to disconnect from the LiveKit server.

```javascript
game.socket.emit("module.avclient-livekit", { action: "disconnect" });
```

#### `render`

Commands all clients to re-render their camera views.

```javascript
game.socket.emit("module.avclient-livekit", { action: "render" });
```

---

## Module Settings

All settings are accessible via `game.settings.get("avclient-livekit", key)`.

### Client-Scoped Settings

| Key                        | Type      | Default | Description                                                                       |
| -------------------------- | --------- | ------- | --------------------------------------------------------------------------------- |
| `displayConnectionQuality` | `boolean` | `true`  | Show connection quality indicator on camera views                                 |
| `breakoutRoomRegistry`     | `object`  | `{}`    | Mapping of user IDs to breakout room IDs                                          |
| `audioMusicMode`           | `boolean` | `false` | Optimize audio for music streaming (higher bitrate, stereo, no echo cancellation) |
| `useExternalAV`            | `boolean` | `false` | Open A/V in a separate browser window                                             |

### World-Scoped Settings

| Key                         | Type      | Default | Description                                         |
| --------------------------- | --------- | ------- | --------------------------------------------------- |
| `liveKitConnectionSettings` | `object`  | `{}`    | Server URL, room ID, API key, secret key            |
| `resetRoom`                 | `boolean` | `false` | Trigger to generate a new meeting room ID (GM only) |
| `debug`                     | `boolean` | `false` | Enable debug-level logging                          |
| `liveKitTrace`              | `boolean` | `false` | Enable LiveKit SDK trace-level logging              |
| `devMode`                   | `boolean` | `false` | Expose developer-only settings                      |
| `forceTurn`                 | `boolean` | `false` | Force TURN relay connections (dev mode only)        |

### Connection Settings Object

```typescript
interface LiveKitConnectionSettings {
  url?: string; // LiveKit server WebSocket URL
  room?: string; // Meeting room ID (auto-generated)
  username?: string; // API key
  password?: string; // Secret key
}
```

---

## LiveKitClient Public Properties

When accessed via `game.webrtc.client._liveKitClient`:

| Property                | Type                    | Description                                |
| ----------------------- | ----------------------- | ------------------------------------------ |
| `avMaster`              | `foundry.av.AVMaster`   | Reference to Foundry's A/V master instance |
| `liveKitAvClient`       | `LiveKitAVClient`       | Reference to the AVClient implementation   |
| `settings`              | `foundry.av.AVSettings` | Reference to A/V settings                  |
| `liveKitRoom`           | `Room \| undefined`     | The LiveKit Room object                    |
| `trackManager`          | `LiveKitTrackManager`   | Manager for audio/video tracks (see below) |
| `uiManager`             | `LiveKitUIManager`      | Manager for UI elements (see below)        |
| `breakoutRoom`          | `string \| undefined`   | Current breakout room ID                   |
| `audioBroadcastEnabled` | `boolean`               | Whether audio is being broadcast           |

---

## LiveKitClient Public Methods

| Method                      | Returns               | Description                                      |
| --------------------------- | --------------------- | ------------------------------------------------ |
| `getUserStatistics(userId)` | `string`              | Get connection statistics for a user             |
| `getAllUserStatistics()`    | `Map<string, string>` | Get statistics for all connected users           |
| `isUserExternal(userId)`    | `boolean`             | Check if a user is using the external A/V client |

---

## LiveKitTrackManager

Access via `game.webrtc.client._liveKitClient.trackManager`:

### Properties

| Property              | Type                      | Description                                        |
| --------------------- | ------------------------- | -------------------------------------------------- |
| `audioTrack`          | `LocalAudioTrack \| null` | The local audio track                              |
| `primaryAudioTrack`   | `LocalAudioTrack \| null` | Primary microphone track                           |
| `secondaryAudioTrack` | `LocalAudioTrack \| null` | Secondary microphone track (if configured)         |
| `videoTrack`          | `LocalVideoTrack \| null` | The local video track                              |
| `screenTracks`        | `LocalTrack[]`            | Active screen sharing tracks                       |
| `audioContext`        | `AudioContext \| null`    | Web Audio context for mixing                       |
| `mixedMediaStream`    | `MediaStream \| null`     | Combined audio stream when mixing multiple sources |

### Methods

| Method                                               | Returns                    | Description                         |
| ---------------------------------------------------- | -------------------------- | ----------------------------------- |
| `initializeLocalTracks()`                            | `Promise<void>`            | Initialize local audio/video tracks |
| `changeAudioSource(forceStop?)`                      | `Promise<void>`            | Switch the audio input device       |
| `changeVideoSource()`                                | `Promise<void>`            | Switch the video input device       |
| `setAudioEnabledState(enable)`                       | `Promise<void>`            | Enable or disable audio track       |
| `shareScreen(enabled)`                               | `Promise<void>`            | Start or stop screen sharing        |
| `getUserAudioTrack(odUserId)`                        | `RemoteAudioTrack \| null` | Get a remote user's audio track     |
| `getUserVideoTrack(odUserId)`                        | `RemoteVideoTrack \| null` | Get a remote user's video track     |
| `attachAudioTrack(odUserId, odVideoElement, volume)` | `Promise<void>`            | Attach audio track to video element |
| `attachVideoTrack(odUserId, odVideoElement)`         | `void`                     | Attach video track to video element |

---

## LiveKitUIManager

Access via `game.webrtc.client._liveKitClient.uiManager`:

### Methods

| Method                                                      | Returns                    | Description                              |
| ----------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| `onRenderCameraViews(cameraViews, cameraViewsElement)`      | `void`                     | Handle camera views render hook          |
| `onGetUserContextOptions(playersElement, contextOptions)`   | `void`                     | Add breakout room context menu options   |
| `addConnectionButtons(element)`                             | `void`                     | Add LiveKit control buttons to UI        |
| `setConnectionButtons(connected)`                           | `void`                     | Update button states based on connection |
| `addConnectionQualityIndicator(odUserId, odUserCameraView)` | `void`                     | Add quality indicator dot to camera view |
| `getUserAudioElement(odUserId, odVideoElement, volume)`     | `HTMLAudioElement \| null` | Get or create audio element for user     |

---

## CSS Classes

These CSS classes are added to camera view elements and can be targeted for custom styling:

| Class                                     | Element   | Description                          |
| ----------------------------------------- | --------- | ------------------------------------ |
| `.connection-quality-indicator`           | `<div>`   | Connection quality dot container     |
| `.connection-quality-indicator.excellent` | `<div>`   | Green dot — excellent connection     |
| `.connection-quality-indicator.good`      | `<div>`   | Yellow dot — good connection         |
| `.connection-quality-indicator.poor`      | `<div>`   | Red dot — poor connection            |
| `.connection-quality-indicator.unknown`   | `<div>`   | Grey dot — unknown quality           |
| `.livekit-control`                        | button    | Custom LiveKit control button        |
| `.livekit-control.hidden`                 | button    | Hidden control (display: none)       |
| `.livekit-control.disabled`               | button    | Disabled control (no pointer events) |
| `.status-remote-hidden`                   | `<i>`     | Icon for remotely hidden users       |
| `.status-remote-muted`                    | `<i>`     | Icon for remotely muted users        |
| `.status-remote-ptt`                      | `<i>`     | Push-to-talk status indicator        |
| `.status-remote-ptt.active`               | `<i>`     | Active push-to-talk (green)          |
| `.local-camera`                           | `<video>` | Mirrored local camera view           |
