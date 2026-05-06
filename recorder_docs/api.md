# Recorder HTTP API Reference

Base URL: `http://<host>:8090` (default port; configurable via `PORT` env var).

## Authentication

All API routes require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <API_TOKEN>
```

The token is set via the `API_TOKEN` environment variable. If not set, one is auto-generated at startup and logged to stdout.

The WebSocket endpoint uses a single-use ticket instead (see below).

## CORS

Cross-Origin Resource Sharing is controlled via the `ALLOWED_ORIGINS` environment variable. When set to a comma-separated list of origins, the recorder returns CORS headers permitting cross-origin requests with credentials.

Browser preflight (`OPTIONS`) requests are answered by `CORSMiddleware` before the auth layer runs.

Leave `ALLOWED_ORIGINS` empty (default) to disable CORS entirely.

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

**Errors**: `429` (rate limit exceeded, default 10/min).

---

## Endpoints

### POST /recording/start

Start recording a LiveKit room. Only one recording per room is allowed.

**Request body** (JSON):

| Field        | Type            | Required | Description                                                                 |
|--------------|-----------------|----------|-----------------------------------------------------------------------------|
| `room`       | string          | yes      | Room name. Alphanumeric start, then `[a-zA-Z0-9._-]`, max 200 chars.       |
| `session_id` | string \| null  | no       | Custom session ID. Same format constraints. Must not already exist on disk. |
| `bitrate`    | int \| null     | no       | Opus bitrate in bps (32000-510000). Default: `OPUS_BITRATE` env (128000).  |
| `application`| string \| null  | no       | Opus coding mode: `"audio"` or `"voip"`. Default: `OPUS_APPLICATION` env.  |

**Response** (`200`):

```json
{
  "status": "recording",
  "room": "my-room",
  "session_id": "my-room_2025-01-01T10-00-00",
  "message": "Recording started for room 'my-room'"
}
```

**Errors**: `404`, `409`, `422`, `500`.

---

### POST /recording/stop

Stop recording a room. Session finalization runs inline — the response returns after all `.opus` files are closed.

**Request body** (JSON):

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| `room` | string | yes      | Room name.  |

**Response** (`200`):

```json
{
  "status": "stopped",
  "room": "my-room",
  "session_id": "my-room_2025-01-01T10-00-00",
  "message": "Recording stopped for room 'my-room'. Use POST /recording/mix to generate multi-channel output."
}
```

**Errors**: `404`, `500`.

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

Detailed status for a specific active recording.

**Response** (`200`):

```json
{
  "room": "my-room",
  "session_id": "my-room_2025-01-01T10-00-00",
  "is_active": true,
  "participants": {
    "user-1": {
      "is_receiving": true,
      "samples_written": 480000
    }
  }
}
```

**Errors**: `404`.

---

### POST /recording/mix/{session_id}

Start or retrieve a multi-channel mix for a completed session.

**Request body** (JSON):

| Field        | Type   | Required | Description                                                      |
|--------------|--------|----------|------------------------------------------------------------------|
| `format`     | string | yes      | `"flac"` or `"opus"`.                                           |
| `compression`| int    | no       | FLAC compression level (0-12). Default: 8.                      |
| `bitrate`    | int    | no       | Opus bitrate in bps. Default: `MIX_OPUS_BITRATE` env (192000).  |

**Response** (`200` — cached):

```json
{
  "status": "ready",
  "path": "session.mix.flac",
  "size_bytes": 2994739200,
  "format": "flac"
}
```

**Response** (`202` — new job started):

```json
{
  "status": "in_progress",
  "started_at": 1714800000.0,
  "format": "flac"
}
```

**Errors**: `404`.

---

### GET /recording/mix/{session_id}

Get the status of a multi-channel mix.

**Query**: `?format=flac|opus` (default: `flac`)

**Response** (`200`):

```json
{
  "status": "not_started | in_progress | ready | failed",
  "progress_pct": 0.0,
  "started_at": 1714800000.0,
  "completed_at": 1714800600.0,
  "size_bytes": 2994739200,
  "path": "/recordings/session/session.mix.flac",
  "error": "Error message if failed"
}
```

**Errors**: `404`.

---

### GET /recording/download/{session_id}

Download the multi-channel mix for a completed session.

**Query**: `?format=flac|opus` (required)

**Responses**:

| Status | Condition                | Body                      |
|--------|--------------------------|---------------------------|
| 200    | Mix ready                | Binary file stream        |
| 202    | Mix in progress          | JSON with progress info   |
| 409    | Mix not started          | JSON with hint to POST    |
| 404    | Session not found        | JSON error                |
| 500    | Mix failed               | JSON with error           |

---

### GET /recording/download/{session_id}/participant/{identity}

Stream a single participant's OGG/Opus file.

**Responses**:

| Status | Condition                | Body                      |
|--------|--------------------------|---------------------------|
| 200    | File found               | Binary .opus stream       |
| 404    | Participant or session not found | JSON error        |

---

### GET /recording/{session_id}/download-all

Download the entire session directory as a ZIP archive. Includes per-participant `.opus` files, `manifest.json`, and metadata. **Excludes** any cached multi-channel mix files.

**Responses**: `200`, `404`.

---

### GET /recording/{session_id}/manifest

Get the session manifest JSON.

**Response** (`200`):

```json
{
  "session_id": "my-room_2025-01-01T10-00-00",
  "room_name": "my-room",
  "start_epoch": 1714800000.0,
  "end_epoch": 1714800300.0,
  "status": "complete",
  "participants": ["user-1", "user-2"],
  "format": "opus",
  "bitrate": 128000,
  "application": "audio"
}
```

**Errors**: `404`.

---

### DELETE /recording/{session_id}

Delete a completed recording session and all its files.

**Response** (`200`): `{"status": "deleted", "session_id": "...", "message": "..."}`

**Errors**: `404` (not found), `409` (still active).

---

### GET /recordings

List all recording sessions grouped by room name.

**Response** (`200`):

```json
{
  "rooms": {
    "my-room": [
      {
        "session_id": "my-room_2025-01-01T10-00-00",
        "room_name": "my-room",
        "start_epoch": 1714800000.0,
        "end_epoch": 1714800300.0,
        "status": "complete",
        "participants": ["user-1", "user-2"],
        "has_flac": true,
        "has_opus": false,
        "is_active": false
      }
    ]
  }
}
```

---

### DELETE /recordings/{room}

Delete all recording sessions for a specific room. Active recordings are skipped.

**Errors**: `404`.

---

## WebSocket — Real-time Events

**Endpoint**: `wss://<host>:8090/ws?ticket=<ticket>`

Authentication is ticket-based:
1. Call `POST /auth/ws-ticket` with your Bearer token to get a single-use ticket.
2. Connect to `/ws?ticket=<ticket>` within the ticket's TTL (default 60s).

The ticket is consumed on connection — each reconnect requires a new ticket.

### Events

- **recording_started**: `{"event": "recording_started", "session_id": "...", "room": "..."}`
- **recording_stopped**: `{"event": "recording_stopped", "session_id": "...", "room": "...", "reason": "silence_timeout"}` (reason is optional)
- **mix_started**: `{"event": "mix_started", "session_id": "...", "format": "flac", "started_at": 1714800000.0}`
- **mix_progress**: `{"event": "mix_progress", "session_id": "...", "format": "flac", "progress_pct": 45.0}`
- **mix_complete**: `{"event": "mix_complete", "session_id": "...", "format": "flac", "path": "...", "size_bytes": 2994739200, "completed_at": 1714800600.0}`
- **mix_failed**: `{"event": "mix_failed", "session_id": "...", "format": "flac", "error": "...", "failed_at": 1714800600.0}`

---

## Session Lifecycle

```
start → recording → stop → complete
                              |
                              v (on demand)
                          POST /recording/mix → polling/WS → download
```

1. `POST /recording/start` — bot joins room, writes per-participant OGG/Opus files in real-time.
2. `POST /recording/stop` — bot leaves room, `.opus` files finalized. Response returns immediately.
3. `POST /recording/mix/{session_id}` — start FFmpeg merge of per-participant `.opus` files into a multi-channel mix.
4. Poll `GET /recording/mix/{session_id}` or listen on WebSocket for completion.
5. `GET /recording/download/{session_id}?format=flac|opus` — download the mix.

## Output Format

- **Per-participant**: OGG/Opus, 48 kHz, mono, configurable bitrate (default 128 kbps).
- **Multi-channel mix**: FLAC (48 kHz, N channels, level 8 compression) or Opus (48 kHz, N channels, mapping family 255, configurable bitrate default 192 kbps).
- **Timeline-aligned**: Silence frames are written during gaps to maintain wall-clock alignment.
- Per-participant `.opus` files are preserved after mix — they serve as the source of truth for transcription with speaker recognition.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPUS_BITRATE` | `128000` | Per-participant Opus bitrate in bps |
| `OPUS_APPLICATION` | `"audio"` | Opus coding mode: `"audio"` or `"voip"` |
| `MIX_DEFAULT_FORMAT` | `"flac"` | Default mix output format |
| `MIX_FLAC_COMPRESSION_LEVEL` | `8` | FLAC compression level (0-12) |
| `MIX_OPUS_BITRATE` | `192000` | Opus mix bitrate in bps |

See `README.md` for the full environment variable reference.
