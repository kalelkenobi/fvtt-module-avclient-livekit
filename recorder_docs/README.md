# livekit-recorder

`livekit-recorder` is a small FastAPI service that joins a LiveKit room as a participant (hidden by default, configurable via `RECORDER_HIDDEN`), records each remote participant to a single continuous OGG/Opus file (with real-time silence filling for disconnection gaps), and produces a multi-channel FLAC or Opus mix on demand via FFmpeg.

It is designed for server-side control: another system starts and stops recording by calling the HTTP API, while the recorder bot connects to LiveKit, subscribes to remote audio tracks, and writes recordings to the filesystem.

## What It Does

- Runs one recorder bot per room.
- Records each participant into a single continuous OGG/Opus file under a session folder.
- A background silence-writer task writes silent PCM frames every 20ms whenever a participant is not sending audio, keeping all participant files time-aligned. Opus DTX compresses these silent frames to ~2 bytes per page.
- Persists participant metadata in `metadata.json` and session metadata in `manifest.json`.
- Reuses the same participant recorder across reconnects by participant identity.
- On demand, runs FFmpeg to merge per-participant `.opus` files into a single multi-channel FLAC or Opus file.
- Provides download, manifest, ZIP export, and delete endpoints.

## Comparison: Old (PCM+WAV) vs New (Opus+Lazy Mix)

| | Old (v0.x) | New (v1.0.0) |
|---|---|---|
| Per-participant format | Raw PCM (16-bit) | OGG/Opus (configurable bitrate) |
| Multi-channel output | WAV (eager, auto) | FLAC or Opus (lazy, on-demand) |
| ~5 participants × 3.5h peak disk | ~15.5 GB | ~625 MB |
| 4 GB WAV ceiling | Crashes | No ceiling (OGG/Opus handles >4 GB) |
| Disk after output | ~8 GB WAV | ~3.4 GB FLAC or ~500 MB Opus mix |
| Mix wall-clock | Hours (sometimes crashes) | Minutes |

## Requirements

- Python `>=3.11`
- LiveKit server reachable over WebSocket
- Valid `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
- **FFmpeg** on PATH (required)
- **libsndfile** >= 1.0.29 with Opus support (bundled with `soundfile` wheel)

## Install

Local installation mirrors the container build:

```bash
pip install -r requirements.txt
pip install .
```

## Configuration

The service reads its runtime configuration from environment variables.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LIVEKIT_URL` | No | `ws://localhost:7880` | LiveKit server URL |
| `LIVEKIT_API_KEY` | Yes | none | API key used to mint the bot token |
| `LIVEKIT_API_SECRET` | Yes | none | API secret used to mint the bot token |
| `RECORDINGS_DIR` | No | `/recordings` | Base directory for session output |
| `HOST` | No | `0.0.0.0` | HTTP bind host |
| `PORT` | No | `8090` | HTTP bind port |
| `LOG_LEVEL` | No | `INFO` | Python logging level |
| `RECORDER_HIDDEN` | No | `true` | Whether the bot joins as a hidden participant |
| `API_TOKEN` | No | auto-generated | Bearer token for HTTP/WS authentication |
| `MAX_WS_CLIENTS` | No | `50` | Maximum concurrent WebSocket connections |
| `SILENCE_TIMEOUT` | No | `10` | Minutes of silence before auto-stopping |
| `RECORDING_TTL` | No | `72` | Hours after which session folders are auto-deleted |
| `REQUIRE_TLS` | No | `false` | Reject WS upgrades without `x-forwarded-proto: https` |
| `WS_TICKET_TTL` | No | `60` | Seconds before unused WebSocket ticket expires |
| `WS_TICKET_RATE_LIMIT` | No | `10` | Max WebSocket tickets minted per minute |
| `ALLOWED_ORIGINS` | No | `""` (empty) | Comma-separated CORS origins |
| `OPUS_BITRATE` | No | `128000` | Per-participant Opus bitrate in bps (32000-510000) |
| `OPUS_APPLICATION` | No | `"audio"` | Opus coding mode: `"audio"` or `"voip"` |
| `MIX_DEFAULT_FORMAT` | No | `"flac"` | Default mix output format |
| `MIX_FLAC_COMPRESSION_LEVEL` | No | `8` | FLAC compression level (0-12) |
| `MIX_OPUS_BITRATE` | No | `192000` | Opus mix bitrate in bps |

`recorder.main` exits at startup if `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` is missing, or if FFmpeg or soundfile Opus support are not available.

## Run Locally

```bash
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
export RECORDINGS_DIR="$(pwd)/recordings"

livekit-recorder
```

## HTTP API

The service exposes the following routes:

- `POST /auth/ws-ticket` — mint a single-use WebSocket authentication ticket
- `POST /recording/start` — start recording a room (accepts optional `bitrate` and `application`)
- `POST /recording/stop` — stop recording a room
- `GET /recording/status` — list all active recordings
- `GET /recording/status/{room}` — detailed status for a room
- `POST /recording/mix/{session_id}` — start or retrieve a multi-channel mix
- `GET /recording/mix/{session_id}` — get mix status
- `GET /recording/download/{session_id}` — download mix file (`?format=flac|opus` required)
- `GET /recording/download/{session_id}/participant/{identity}` — download per-participant .opus
- `GET /recording/{session_id}/manifest` — get session manifest
- `GET /recording/{session_id}/download-all` — download session as ZIP (excludes mixes)
- `DELETE /recording/{session_id}` — delete a completed recording
- `GET /recordings` — list all sessions grouped by room
- `DELETE /recordings/{room}` — delete all sessions for a room
- `WS /ws` — WebSocket real-time events (ticket-based auth)

### Quick Example: Full Lifecycle

```bash
# 1. Start recording (custom bitrate optional)
curl -X POST http://localhost:8090/recording/start \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"my-room", "bitrate": 128000}'

# 2. Stop recording
curl -X POST http://localhost:8090/recording/stop \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"my-room"}'

# 3. Start mix (replace session_id from step 1 response)
curl -X POST http://localhost:8090/recording/mix/{session_id} \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format":"flac"}'

# 4. Poll mix status
curl -H "Authorization: Bearer $API_TOKEN" \
  "http://localhost:8090/recording/mix/{session_id}?format=flac"

# 5. Download mix when ready
curl -H "Authorization: Bearer $API_TOKEN" \
  -o output.flac \
  "http://localhost:8090/recording/download/{session_id}?format=flac"

# 6. Or download individual participant audio
curl -H "Authorization: Bearer $API_TOKEN" \
  "http://localhost:8090/recording/download/{session_id}/participant/alice"
```

Notes:
- `POST /recording/start` accepts optional `bitrate` (32000-510000 bps) and `application` ("audio" or "voip") fields.
- `POST /recording/stop` returns after `.opus` files are finalized; no post-processing runs.
- `GET /recording/download/{session_id}` returns `409 Conflict` if no mix has been generated — call `POST /recording/mix/{session_id}` first.
- `GET /recording/download/{session_id}/participant/{identity}` streams per-participant `.opus` files directly.
- All API endpoints require a valid `Authorization: Bearer <token>` header.
- For the full API reference, see [`docs/api.md`](docs/api.md).

## Output Layout

```text
/recordings/
└── my-room_2026-05-06T10-30-00/
    ├── manifest.json
    ├── alice/
    │   ├── metadata.json
    │   └── alice.opus
    ├── bob/
    │   ├── metadata.json
    │   └── bob.opus
    ├── my-room_2026-05-06T10-30-00.mix.flac          (if FLAC mix requested)
    └── my-room_2026-05-06T10-30-00.mix.flac.json      (mix sidecar)
```

The `manifest.json` includes:

```json
{
  "session_id": "my-room_2026-05-06T10-30-00",
  "room_name": "my-room",
  "start_epoch": 1713801000.0,
  "end_epoch": 1713804600.0,
  "participants": ["alice", "bob"],
  "status": "complete",
  "format": "opus",
  "bitrate": 128000,
  "application": "audio"
}
```

Per-participant `.opus` files are the source of truth for downstream processing (transcription, speaker recognition). The multi-channel mix is a convenience artifact.

## Web UI

Access the built-in web interface at `http://localhost:8090/ui/`.

See [`docs/web-ui.md`](docs/web-ui.md) for details.

## Architecture

For the end-to-end flow, module boundaries, and event lifecycle, see [`docs/architecture.md`](docs/architecture.md).

## Testing

Run the offline unit test suite:

```bash
.venv/bin/python -m unittest discover -s tests -t .
```

Run the end-to-end suite:

```bash
.venv/bin/pytest tests_e2e -q
```

## Recovery CLI

Re-mix an offline session directory:

```bash
python -m recorder.recover <session_dir> --format flac|opus [--compression N] [--bitrate N]
```
