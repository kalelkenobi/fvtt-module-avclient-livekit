# Recorder HTTP API Reference

Base URL: `http://<host>:8090` (default port; configurable via `PORT` env var).

## Authentication

All API routes require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <API_TOKEN>
```

The token is set via the `API_TOKEN` environment variable. If not set, one is auto-generated at startup and logged to stdout.

The WebSocket endpoint uses a single-use ticket instead (see below).

---

### POST /auth/ws-ticket

Mint a single-use, short-lived ticket for WebSocket authentication.

**Request body**: none.

**Response** (`200`):

```json
{
  "ticket": "random-opaque-string",
  "expires_in": 60
}
```

The ticket is valid for `WS_TICKET_TTL` seconds (default 60) and can only be used once.

**Errors**:

| Status | Condition                              |
|--------|----------------------------------------|
| 429    | Rate limit exceeded (default 10/min)   |

---

## Endpoints

### POST /recording/start

Start recording a LiveKit room. Only one recording per room is allowed.

**Request body** (JSON):

| Field        | Type            | Required | Description                                                                 |
|--------------|-----------------|----------|-----------------------------------------------------------------------------|
| `room`       | string          | yes      | Room name. Alphanumeric start, then `[a-zA-Z0-9._-]`, max 200 chars.       |
| `session_id` | string \| null  | no       | Custom session ID. Same format constraints. Must not already exist on disk. |

**Response** (`200`):

```json
{
  "status": "recording",
  "room": "my-room",
  "session_id": "my-room_1714800000_abc123",
  "message": "Recording started for room 'my-room'"
}
```

**Errors**:

| Status | Condition                              |
|--------|----------------------------------------|
| 409    | Room is already being recorded         |
| 409    | Custom `session_id` already exists     |
| 422    | Invalid `room` or `session_id` format  |
| 500    | Bot failed to connect to LiveKit       |

---

### POST /recording/stop

Stop recording a room. WAV packaging runs asynchronously in the background — the response returns immediately.

**Request body** (JSON):

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| `room` | string | yes      | Room name.  |

**Response** (`200`):

```json
{
  "status": "stopped",
  "room": "my-room",
  "session_id": "my-room_1714800000_abc123",
  "message": "Recording stopped for room 'my-room'. WAV packaging in progress."
}
```

**Errors**:

| Status | Condition                        |
|--------|----------------------------------|
| 404    | No active recording for room     |
| 500    | Error stopping the bot           |

---

### GET /recording/status

List all currently active recordings.

**Response** (`200`):

```json
{
  "active_rooms": ["room-a", "room-b"],
  "recordings_dir": "/recordings"
}
```

---

### GET /recording/status/{room}

Detailed status for a specific active recording, including per-participant metrics.

**Response** (`200`):

```json
{
  "room": "my-room",
  "session_id": "my-room_1714800000_abc123",
  "is_active": true,
  "participants": {
    "user-1": {
      "is_receiving": true,
      "bytes_written": 1048576
    }
  }
}
```

**Errors**:

| Status | Condition                    |
|--------|------------------------------|
| 404    | No active recording for room |

---

### GET /recording/download/{session_id}

Download the final multi-channel WAV file for a completed session.

**Responses**:

| Status | Condition                                  | Body                        |
|--------|--------------------------------------------|-----------------------------|
| 200    | WAV ready                                  | Binary WAV file stream      |
| 202    | Packaging still in progress                | JSON with `status: "packaging"` |
| 404    | Session or manifest not found              | JSON error                  |

The `202` response means you should poll again after a short delay.

---

### GET /recording/{session_id}/download-all

Download the entire session directory as a ZIP archive (includes manifest, WAV, per-participant PCMs, and metadata). Useful for offline processing.

**Responses**:

| Status | Condition             | Body               |
|--------|-----------------------|--------------------|
| 200    | ZIP ready             | Binary ZIP stream  |
| 404    | Session not found     | JSON error         |

---

### GET /recording/{session_id}/manifest

Get the session manifest JSON.

**Response** (`200`) — example after packaging is complete:

```json
{
  "session_id": "my-room_1714800000_abc123",
  "room_name": "my-room",
  "start_epoch": 1714800000.0,
  "end_epoch": 1714800300.0,
  "status": "complete",
  "participants": ["user-1", "user-2"],
  "output_file": "recording.wav",
  "channel_map": {
    "0": "user-1",
    "1": "user-2"
  },
  "sample_rate": 48000,
  "sample_width": 2,
  "channels": 2
}
```

Key fields:

| Field          | Description                                                        |
|----------------|--------------------------------------------------------------------|
| `output_file`  | Filename of the final WAV. `null` if packaging is not yet done.    |
| `channel_map`  | Maps WAV channel index (0-based) to participant identity.          |
| `sample_rate`  | Always 48000 Hz.                                                   |
| `sample_width` | Always 2 (16-bit PCM).                                             |
| `status`       | `"recording"`, `"finalizing"`, or `"complete"`.                    |

**Errors**:

| Status | Condition                        |
|--------|----------------------------------|
| 404    | Session or manifest not found    |

---

### DELETE /recording/{session_id}

Delete a completed recording session and all its files.

**Response** (`200`):

```json
{
  "status": "deleted",
  "session_id": "my-room_1714800000_abc123",
  "message": "Session 'my-room_1714800000_abc123' deleted successfully."
}
```

**Errors**:

| Status | Condition                                  |
|--------|--------------------------------------------|
| 404    | Session not found                          |
| 409    | Session is still actively recording        |

---

### GET /recordings

List all recording sessions grouped by room name.

**Response** (`200`):

```json
{
  "rooms": {
    "my-room": [
      {
        "session_id": "my-room_1714800000_abc123",
        "room_name": "my-room",
        "start_epoch": 1714800000.0,
        "end_epoch": 1714800300.0,
        "status": "complete",
        "participants": ["user-1", "user-2"],
        "has_wav": true,
        "is_active": false
      }
    ]
  }
}
```

---

### DELETE /recordings/{room}

Delete all recording sessions for a specific room. Active recordings are skipped.

**Response** (`200`):

```json
{
  "status": "deleted",
  "room": "my-room",
  "deleted": ["my-room_1714800000_abc123"],
  "skipped_active": []
}
```

**Errors**:

| Status | Condition                          |
|--------|------------------------------------|
| 404    | No recordings found for that room  |

---

## WebSocket — Real-time Events

**Endpoint**: `wss://<host>:8090/ws?ticket=<ticket>`

Authentication is ticket-based:
1. Call `POST /auth/ws-ticket` with your Bearer token to get a single-use ticket.
2. Connect to `/ws?ticket=<ticket>` within the ticket's TTL (default 60s).

The ticket is consumed on connection — each reconnect requires a new ticket.

After connecting, the server pushes JSON events. The client should keep the connection alive (send any text as a ping). Events:

```json
{"event": "recording_started", "session_id": "...", "room": "my-room"}
```

### recording_stopped

```json
{"event": "recording_stopped", "session_id": "...", "room": "my-room"}
```

Includes an optional `"reason": "silence_timeout"` field when auto-stopped due to silence.

### packaging_complete

```json
{"event": "packaging_complete", "session_id": "...", "room": "my-room"}
```

Fired when the WAV file is ready for download.

---

## Session Lifecycle

```
start → recording → stop → packaging (background) → complete
```

1. `POST /recording/start` — bot joins room, begins capturing PCM audio per participant.
2. Audio is written as raw PCM segments with `segments.json` sidecar per participant.
3. `POST /recording/stop` — bot leaves room, segments are finalized. Response returns immediately.
4. Background task merges all PCM segments per participant (inserting silence for gaps), produces a single multi-channel WAV, updates the manifest, and removes intermediate PCM files.
5. `packaging_complete` WebSocket event fires. The WAV is now downloadable.

Polling approach (if not using WebSocket): after stopping, poll `GET /recording/download/{session_id}` until you get `200` instead of `202`.

---

## Output Format

The final WAV file is:

- **Multi-channel**: one channel per participant who produced audio.
- **48 kHz, 16-bit signed PCM**.
- **Timeline-aligned**: silence is inserted to preserve the original timing of speech segments.

Use the `channel_map` from the manifest to identify which channel belongs to which participant identity.
