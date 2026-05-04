# livekit-recorder

`livekit-recorder` is a small FastAPI service that joins a LiveKit room as a participant (hidden by default, configurable via `RECORDER_HIDDEN`), records each remote participant to a single continuous PCM file (with real-time silence filling for disconnection gaps), and packages those into a single multi-channel WAV file after recording stops — one channel per participant, timeline-aligned for downstream processing.

It is designed for server-side control: another system starts and stops recording by calling the HTTP API, while the recorder bot connects to LiveKit, subscribes to remote audio tracks, and writes recordings to the filesystem.

## What It Does

- Runs one recorder bot per room.
- Records each participant into a single continuous PCM file under a session folder.
- A background silence-writer task fills zeros at a constant byte rate whenever a participant is not sending audio, keeping all participant files time-aligned to wall-clock time from session start.
- Persists participant metadata in `metadata.json` and session metadata in `manifest.json`.
- Reuses the same participant recorder across reconnects by participant identity — reconnecting simply resumes writing audio frames to the same file.
- After recording stops, creates a single multi-channel WAV from all participant PCM files. Per-participant PCM files and metadata are preserved for offline processing.
- Provides download, manifest, ZIP export, and delete endpoints so callers can retrieve the final audio, inspect the channel-to-speaker mapping, and clean up after themselves.

## Intended Use

- Run recording on the server side instead of in player browsers.
- Let an external controller, such as a Foundry VTT macro or module, call `POST /recording/start` and `POST /recording/stop`.
- Preserve participant continuity across disconnects and reconnects by recording against the stable LiveKit participant identity.
- Produce a multi-channel audio file with a channel map for speaker identification.

## Why This Design

- It keeps recording server-side, which avoids relying on browser-local capture and upload.
- It is lighter than running LiveKit Egress for a track-by-track recording workflow on a small self-hosted deployment.
- A single continuous PCM file per participant with real-time silence filling guarantees byte-level timeline alignment — no post-hoc segment merging or gap calculation needed.
- Reconnects are handled seamlessly: the same file continues being written to, with silence filling the disconnection gap automatically.
- Overlapping speech is preserved perfectly: each speaker has their own independent channel, so simultaneous audio never interferes.
- It records by participant identity, which makes reconnect handling trivial.

## Repository Layout

- `recorder/main.py`: FastAPI app, environment loading, active room registry, HTTP endpoints.
- `recorder/bot.py`: LiveKit connection logic and room event handlers.
- `recorder/session.py`: session creation, manifest writing, recorder registry.
- `recorder/participant_recorder.py`: per-participant continuous PCM writing with background silence filler.
- `recorder/wav_packager.py`: multi-channel WAV creation from participant PCM files, and intermediate file cleanup.
- `recorder/static/`: Web UI static files (HTML, JS, CSS) served at `/ui/`.
- `docs/architecture.md`: detailed application flow and architecture.

## Requirements

- Python `>=3.11`
- LiveKit server reachable over WebSocket
- Valid `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`

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
| `RECORDER_HIDDEN` | No | `true` | Whether the bot joins as a hidden participant. Set to `false` (or `0`/`no`) to make the bot visible in the room's participant list — useful for verifying the bot is actually joining |
| `API_TOKEN` | No | auto-generated | Bearer token for HTTP/WS authentication. If not set, a random token is generated at startup and logged. See [`docs/authentication.md`](docs/authentication.md) |
| `MAX_WS_CLIENTS` | No | `50` | Maximum concurrent WebSocket connections |
| `SILENCE_TIMEOUT` | No | `10` | Minutes of silence (no audio frames received) before auto-stopping a recording. Set to `0` to disable |
| `RECORDING_TTL` | No | `72` | Hours after which completed recording session folders are automatically deleted. Set to `0` to disable |
| `REQUIRE_TLS` | No | `false` | Reject WebSocket upgrades without `x-forwarded-proto: https`. Set to `true` in production behind a TLS-terminating proxy |
| `WS_TICKET_TTL` | No | `60` | Seconds before an unused WebSocket ticket expires |
| `WS_TICKET_RATE_LIMIT` | No | `10` | Maximum WebSocket tickets minted per minute |

`recorder.main` exits at startup if `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` is missing.

## Run Locally

```bash
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
export RECORDINGS_DIR="$(pwd)/recordings"

livekit-recorder
```

The service listens on `0.0.0.0:8090` by default.

## Run In A Container

The repository ships a `ContainerFile`, not a `Dockerfile`.

A multi-arch image (`linux/amd64`, `linux/arm64`) is published to Docker Hub by CI on every push to `main` and on every `vX.Y.Z` git tag (see [`docs/ci.md`](docs/ci.md)):

```bash
docker pull kalelkenobi/livekit-recorder:latest
```

To build locally instead, pass `-f ContainerFile`:

```bash
docker build -f ContainerFile -t livekit-recorder .
```

Example run command:

```bash
docker run --rm \
  -p 8090:8090 \
  -e LIVEKIT_URL="ws://livekit-host:7880" \
  -e LIVEKIT_API_KEY="your-api-key" \
  -e LIVEKIT_API_SECRET="your-api-secret" \
   -v "$(pwd)/recordings:/recordings" \
   livekit-recorder
```

Replace `livekit-host` with a hostname or IP that is reachable from inside the container network.

If you use Podman instead of Docker, use the same `-f ContainerFile` pattern with `podman build` and `podman run`.

For ready-to-use runtime assets (Podman Quadlet, Docker Compose, plain
`docker run`, and Apple `container` scripts), see
[`deploy/README.md`](deploy/README.md) and [`docs/deploy.md`](docs/deploy.md).

## HTTP API

The service exposes the following routes:

- `POST /auth/ws-ticket` — mint a single-use WebSocket authentication ticket
- `POST /recording/start`
- `POST /recording/stop`
- `GET /recording/status`
- `GET /recording/status/{room}`
- `GET /recording/download/{session_id}`
- `GET /recording/{session_id}/manifest`
- `DELETE /recording/{session_id}`
- `GET /recordings` — list all sessions grouped by room
- `GET /recording/{session_id}/download-all` — download session as ZIP archive
- `DELETE /recordings/{room}` — delete all sessions for a room
- `WS /ws` — WebSocket for real-time event notifications (ticket-based auth; see [`docs/authentication.md`](docs/authentication.md))

Start a recording:

```bash
curl -X POST http://localhost:8090/recording/start \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"my-room"}'
```

Start with a custom session ID:

```bash
curl -X POST http://localhost:8090/recording/start \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"my-room", "session_id":"my-custom-session"}'
```

Stop a recording:

```bash
curl -X POST http://localhost:8090/recording/stop \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"my-room"}'
```

List active rooms:

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:8090/recording/status
```

Inspect one room:

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:8090/recording/status/my-room
```

Download the final WAV for a completed session:

```bash
curl -H "Authorization: Bearer $API_TOKEN" -o recording.wav http://localhost:8090/recording/download/{session_id}
```

Get the session manifest (includes channel map for speaker identification):

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:8090/recording/{session_id}/manifest
```

Delete a completed recording:

```bash
curl -H "Authorization: Bearer $API_TOKEN" -X DELETE http://localhost:8090/recording/{session_id}
```

Notes:

- `POST /recording/start` accepts an optional `session_id` field. If provided, it must start with an alphanumeric character and contain only `[a-zA-Z0-9._-]` (max 200 chars). Returns `422` if invalid, `409` if already exists.
- `POST /recording/start` returns `409` if the room is already being recorded.
- `POST /recording/stop` returns before WAV packaging finishes. The HTTP response means capture has stopped, not that the final `.wav` file is already present.
- `GET /recording/download/{session_id}` returns `202` if packaging is still in progress, `404` if the session doesn't exist, or streams the WAV on `200`.
- `GET /recording/{session_id}/manifest` returns the manifest JSON including `channel_map` (channel index → participant identity) for speaker identification.
- `DELETE /recording/{session_id}` returns `409` if the session is still actively recording, `404` if not found, or `200` on successful deletion.
- All API endpoints require a valid `Authorization: Bearer <token>` header. See [`docs/authentication.md`](docs/authentication.md).
- For the full API reference (request/response schemas, status codes, WebSocket events), see [`docs/api.md`](docs/api.md).

## Output Layout

Each session gets its own directory under `RECORDINGS_DIR`.

While capture is active, participant directories contain a single `.pcm` file each:

```text
/recordings/
└── my-room_2026-04-22T18-30-00/
    ├── manifest.json
    ├── alice/
    │   ├── metadata.json
    │   └── alice.pcm
    └── bob/
        ├── metadata.json
        └── bob.pcm
```

After stop, the background packager creates a single multi-channel WAV. Per-participant PCM files and metadata are preserved for offline processing:

```text
/recordings/
└── my-room_2026-04-22T18-30-00/
    ├── manifest.json
    ├── my-room_2026-04-22T18-30-00.wav
    ├── alice/
    │   ├── metadata.json
    │   └── alice.pcm
    └── bob/
        ├── metadata.json
        └── bob.pcm
```

The `manifest.json` after packaging includes:

```json
{
  "session_id": "my-room_2026-04-22T18-30-00",
  "room_name": "my-room",
  "start_epoch": 1713801000.0,
  "end_epoch": 1713804600.0,
  "participants": ["alice", "bob"],
  "status": "finalized",
  "channel_map": {"0": "alice", "1": "bob"},
  "output_file": "my-room_2026-04-22T18-30-00.wav"
}
```

The `channel_map` tells downstream tools which WAV channel corresponds to which speaker.

## Web UI

The recorder includes a built-in web interface for controlling recordings from a browser. Access it at:

```
http://localhost:8090/ui/
```

Features: start/stop recording, view all sessions by room, download WAV and ZIP files, and delete recordings. Real-time WebSocket notifications automatically enable download buttons when packaging completes.

See [`docs/web-ui.md`](docs/web-ui.md) for details.

## Architecture

For the end-to-end flow, module boundaries, and event lifecycle, see [`docs/architecture.md`](docs/architecture.md).

## Testing

The repository includes a stdlib `unittest` suite for the core filesystem, session, bot handler, and API control logic. The tests stub the external packages they need, so they stay offline and do not require a running LiveKit server.

Run it from the repository root:

```bash
.venv/bin/python -m unittest discover -s tests -t .
```

Run the end-to-end suite:

```bash
.venv/bin/pytest tests_e2e -q
```

For the local testing workflow and what the suite covers, see [`docs/testing.md`](docs/testing.md).

## Current Project Status

- `tests/` contains stdlib `unittest` coverage for the offline behavior. `tests_e2e/` contains a `pytest` end-to-end suite that drives the recorder against a real `livekit-server` running in a container runtime (Apple `container`, Docker, or Podman); see [`docs/e2e-testing.md`](docs/e2e-testing.md).
- CI runs unit tests, e2e tests, and (on `main` and on `vX.Y.Z` git tags) builds and pushes a multi-arch image to `docker.io/kalelkenobi/livekit-recorder`. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and [`docs/ci.md`](docs/ci.md). There is no lint, formatter, or typecheck configuration in the repository today.
- A built-in web UI is available at `/ui/` for browser-based recording control. See [`docs/web-ui.md`](docs/web-ui.md).
