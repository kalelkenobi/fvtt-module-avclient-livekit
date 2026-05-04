import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { Logger } from "./utils/logger";
import { formatRecorderTimestamp } from "./utils/helpers";
import type {
  RecorderActionResponse,
  RecorderRoomStatus,
  RecorderState,
  RecorderWsEvent,
} from "../types/avclient-livekit";
import type LiveKitClient from "./LiveKitClient";

const log = new Logger("LiveKitRecorder");

const WS_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

interface WsTicketResponse {
  ticket: string;
  expires_in: number;
}

/**
 * Integration layer for the remote `livekit-recorder` FastAPI service.
 *
 * Composed onto LiveKitClient and only meaningfully active for GM users.
 *
 * Responsibilities:
 * - HTTP control of the recorder (`start`, `stop`, `delete`, `status`).
 * - Maintaining a long-lived authenticated WebSocket connection that surfaces
 *   `recording_started`, `recording_stopped`, and `packaging_complete` events.
 * - Driving the camera-dock UI state via the LiveKitUIManager.
 *
 * Downloads (WAV / ZIP) are exposed as fetch+blob helpers so the API token is
 * never embedded in a URL. The UI layer awaits `awaitPackaging(sessionId)` to
 * know when the WAV is ready before showing the download dialog.
 */
export default class LiveKitRecorder {
  client: LiveKitClient;

  state: RecorderState = "idle";
  activeSessionId: string | null = null;

  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsBackoffIndex = 0;
  private wsClosingByUs = false;
  private disposed = false;
  private packagingResolvers = new Map<string, () => void>();

  constructor(client: LiveKitClient) {
    this.client = client;
  }

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  /** True when both the recorder URL and an API token are configured. */
  isConfigured(): boolean {
    return !!this.getUrl() && !!this.getToken();
  }

  /** Recorder base URL with any trailing slash trimmed. */
  getUrl(): string {
    const raw = (game.settings?.get(MODULE_NAME, "recorderUrl") ?? "");
    return raw.trim().replace(/\/+$/, "");
  }

  /** Configured bearer token (trimmed). */
  getToken(): string {
    const raw = (game.settings?.get(MODULE_NAME, "recorderApiToken") ?? "");
    return raw.trim();
  }

  /**
   * React to recorder settings changes at runtime: tear down the existing WS
   * and re-init if still configured.
   */
  async reconfigure(): Promise<void> {
    log.debug("reconfigure", { configured: this.isConfigured() });
    this.dispose();
    this.disposed = false;
    if (game.user?.isGM && this.isConfigured()) {
      await this.init();
    } else {
      this.setState("idle");
      this.activeSessionId = null;
    }
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /**
   * Initialise the recorder. Safe to call multiple times — repeated calls
   * re-check the recorder status and re-establish the WebSocket if needed.
   * No-op for non-GM users or when the recorder is unconfigured.
   */
  async init(): Promise<void> {
    if (this.disposed) {
      this.disposed = false;
    }
    if (!game.user?.isGM) {
      log.debug("Skipping recorder init for non-GM user");
      return;
    }
    if (!this.isConfigured()) {
      log.debug("Recorder is not configured; skipping init");
      this.setState("idle");
      this.activeSessionId = null;
      return;
    }

    try {
      const status = await this.checkActiveRecording();
      if (status.active && status.sessionId) {
        this.activeSessionId = status.sessionId;
        this.setState("recording");
        log.info(
          "Resuming recording UI for active session",
          status.sessionId,
        );
      } else {
        this.activeSessionId = null;
        this.setState("idle");
      }
    } catch (error: unknown) {
      log.error("Error checking active recording on init", error);
      this.setState("idle");
    }

    void this.connectWebSocket();
  }

  /** Tear down the WebSocket and clear timers/resolvers. */
  dispose(): void {
    log.debug("dispose");
    this.disposed = true;
    if (this.wsReconnectTimer !== null) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.wsClosingByUs = true;
      try {
        this.ws.close(1000, "client dispose");
      } catch (error: unknown) {
        log.debug("Error closing recorder WebSocket on dispose", error);
      }
      this.ws = null;
    }
    // Reject any pending packaging waiters
    for (const resolve of this.packagingResolvers.values()) {
      resolve();
    }
    this.packagingResolvers.clear();
    this.wsBackoffIndex = 0;
  }

  /* -------------------------------------------- */
  /*  HTTP API wrappers                           */
  /* -------------------------------------------- */

  /** Check whether a recording is currently active for this room. */
  async checkActiveRecording(): Promise<{
    active: boolean;
    sessionId?: string;
  }> {
    const room = this.getRoom();
    if (!room) return { active: false };
    const url = `${this.getUrl()}/recording/status/${encodeURIComponent(room)}`;
    const response = await fetch(url, { headers: this.authHeaders() });
    if (response.status === 404) {
      return { active: false };
    }
    if (!response.ok) {
        throw new Error(
          `Recorder status check failed (${String(response.status)}): ${await response.text()}`,
        );
      }
      const body = (await response.json()) as RecorderRoomStatus;
      return { active: body.is_active, sessionId: body.session_id };
  }

  /**
   * Start a new recording for the configured room. Returns the session id on
   * success, or `null` on failure (an error notification is also surfaced).
   */
  async startRecording(): Promise<string | null> {
    if (!this.isConfigured()) {
      this.notifyError("recorderNotConfigured");
      return null;
    }
    const room = this.getRoom();
    if (!room) {
      this.notifyError("recorderErrorStart");
      return null;
    }
    const sessionId = formatRecorderTimestamp();
    if (!/^[a-zA-Z0-9._-]+$/.test(sessionId)) {
      log.error("Generated invalid session id:", sessionId);
      this.notifyError("recorderErrorStart");
      return null;
    }
    try {
      const response = await fetch(`${this.getUrl()}/recording/start`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ room, session_id: sessionId }),
      });
      if (!response.ok) {
        throw new Error(
          `start failed (${String(response.status)}): ${await response.text()}`,
        );
      }
      const body = (await response.json()) as RecorderActionResponse;
      this.activeSessionId = body.session_id || sessionId;
      this.setState("recording");
      ui.notifications?.info(
        game.i18n?.localize(`${LANG_NAME}.recordingStarted`) ??
          "Recording started.",
      );
      return this.activeSessionId;
    } catch (error: unknown) {
      log.error("Error starting recording", error);
      this.notifyError("recorderErrorStart");
      this.setState("idle");
      this.activeSessionId = null;
      return null;
    }
  }

  /**
   * Stop the active recording. Capture stops immediately on the server side;
   * packaging continues asynchronously and finishes with a `packaging_complete`
   * WS event. Use `awaitPackaging(sessionId)` to block on that event.
   */
  async stopRecording(): Promise<void> {
    if (!this.isConfigured()) {
      this.notifyError("recorderNotConfigured");
      return;
    }
    const room = this.getRoom();
    if (!room) {
      this.notifyError("recorderErrorStop");
      return;
    }
    try {
      this.setState("stopping");
      const response = await fetch(`${this.getUrl()}/recording/stop`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ room }),
      });
      if (!response.ok) {
        throw new Error(
          `stop failed (${String(response.status)}): ${await response.text()}`,
        );
      }
      const body = (await response.json()) as RecorderActionResponse;
      this.activeSessionId = body.session_id || this.activeSessionId;
      this.setState("packaging");
      ui.notifications?.info(
        game.i18n?.localize(`${LANG_NAME}.recordingStopped`) ??
          "Recording stopped.",
      );
    } catch (error: unknown) {
      log.error("Error stopping recording", error);
      this.notifyError("recorderErrorStop");
      // Best-effort recovery: re-check the server state
      try {
        const status = await this.checkActiveRecording();
        this.setState(status.active ? "recording" : "idle");
      } catch (statusError: unknown) {
        log.warn(
          "Unable to refresh recorder state after failed stop",
          statusError,
        );
        this.setState("idle");
      }
      throw error;
    }
  }

  /** Delete a finalized session from the recorder service. */
  async deleteRecording(sessionId: string): Promise<void> {
    if (!this.isConfigured()) {
      this.notifyError("recorderNotConfigured");
      return;
    }
    try {
      const response = await fetch(
        `${this.getUrl()}/recording/${encodeURIComponent(sessionId)}`,
        { method: "DELETE", headers: this.authHeaders() },
      );
      if (!response.ok) {
        throw new Error(
          `delete failed (${String(response.status)}): ${await response.text()}`,
        );
      }
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
      this.setState("idle");
      ui.notifications?.info(
        game.i18n?.localize(`${LANG_NAME}.recordingDeleted`) ??
          "Recording deleted.",
      );
    } catch (error: unknown) {
      log.error("Error deleting recording", error);
      this.notifyError("recorderErrorDelete");
      throw error;
    }
  }

  /**
   * Resolve when `packaging_complete` for the given session id arrives. If
   * the recorder is disposed before that, the promise resolves anyway.
   */
  awaitPackaging(sessionId: string, timeoutMs = 5 * 60 * 1000): Promise<void> {
    if (this.activeSessionId === sessionId && this.state === "idle") {
      // Already done (e.g. event arrived before we awaited)
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.packagingResolvers.delete(sessionId);
        resolve();
      }, timeoutMs);
      this.packagingResolvers.set(sessionId, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /* -------------------------------------------- */
  /*  Downloads                                   */
  /* -------------------------------------------- */

  async downloadWav(sessionId: string): Promise<void> {
    await this.fetchAndDownload(
      `${this.getUrl()}/recording/download/${encodeURIComponent(sessionId)}`,
      `${sessionId}.wav`,
    );
  }

  async downloadZip(sessionId: string): Promise<void> {
    await this.fetchAndDownload(
      `${this.getUrl()}/recording/${encodeURIComponent(sessionId)}/download-all`,
      `${sessionId}.zip`,
    );
  }

  /* -------------------------------------------- */
  /*  WebSocket                                   */
  /* -------------------------------------------- */

  private async connectWebSocket(): Promise<void> {
    if (this.disposed) return;
    if (this.ws) return;
    if (!this.isConfigured()) return;

    let ticket: string;
    try {
      const response = await fetch(`${this.getUrl()}/auth/ws-ticket`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(
          `ws-ticket failed (${String(response.status)}): ${await response.text()}`,
        );
      }
      const body = (await response.json()) as WsTicketResponse;
      ticket = body.ticket;
    } catch (error: unknown) {
      log.error("Could not mint recorder WS ticket", error);
      this.notifyError("recorderErrorWebSocket");
      this.scheduleWsReconnect();
      return;
    }

    const wsUrl = this.toWsUrl(this.getUrl(), ticket);
    log.debug("Opening recorder WebSocket", wsUrl);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error: unknown) {
      log.error("Could not open recorder WebSocket", error);
      this.scheduleWsReconnect();
      return;
    }
    this.ws = ws;
    this.wsClosingByUs = false;

    ws.onopen = () => {
      log.info("Recorder WebSocket open");
      this.wsBackoffIndex = 0;
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as RecorderWsEvent;
        this.handleWsEvent(data);
      } catch (error: unknown) {
        log.warn("Could not parse recorder WS message", event.data, error);
      }
    };
    ws.onerror = (event) => {
      log.warn("Recorder WS error", event);
    };
    ws.onclose = () => {
      log.info("Recorder WebSocket closed");
      this.ws = null;
      if (this.wsClosingByUs || this.disposed) return;
      this.scheduleWsReconnect();
    };
  }

  private handleWsEvent(payload: RecorderWsEvent): void {
    log.debug("WS event:", payload);
    const ourRoom = this.getRoom();
    if (payload.room !== ourRoom) return;

    switch (payload.event) {
      case "recording_started":
        this.activeSessionId = payload.session_id;
        this.setState("recording");
        break;

      case "recording_stopped":
        if (payload.reason === "silence_timeout") {
          ui.notifications?.warn(
            game.i18n?.localize(`${LANG_NAME}.recordingSilenceTimeout`) ??
              "Recording stopped automatically due to silence timeout.",
          );
        }
        this.activeSessionId = payload.session_id;
        this.setState("packaging");
        break;

      case "packaging_complete": {
        this.activeSessionId = payload.session_id;
        const resolver = this.packagingResolvers.get(payload.session_id);
        if (resolver) {
          this.packagingResolvers.delete(payload.session_id);
          resolver();
        }
        this.client.uiManager.onRecordingPackaged(payload.session_id);
        this.setState("idle");
        break;
      }

      default:
        log.debug("Unknown recorder event", payload);
    }
  }

  private scheduleWsReconnect(): void {
    if (this.disposed) return;
    if (this.wsReconnectTimer !== null) return;
    if (!this.isConfigured() || !game.user?.isGM) return;
    const delay =
      WS_BACKOFF_MS[Math.min(this.wsBackoffIndex, WS_BACKOFF_MS.length - 1)];
    this.wsBackoffIndex += 1;
    log.debug("Reconnecting recorder WS in", delay, "ms");
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWebSocket()
        .then(() =>
          this.checkActiveRecording().then((status) => {
            if (status.active && status.sessionId) {
              this.activeSessionId = status.sessionId;
              this.setState("recording");
            }
          }),
        )
        .catch((error: unknown) => {
          log.error("WS reconnect failed", error);
        });
    }, delay);
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  private getRoom(): string | null {
    return this.client.liveKitAvClient.room ?? null;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.getToken()}` };
  }

  private setState(next: RecorderState): void {
    if (this.state === next) return;
    log.debug("Recorder state", this.state, "->", next);
    this.state = next;
    this.client.uiManager.setRecordButtonState(next, this.activeSessionId);
  }

  private notifyError(key: string): void {
    ui.notifications?.error(
      game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key,
    );
  }

  private async fetchAndDownload(url: string, filename: string): Promise<void> {
    if (!this.isConfigured()) {
      this.notifyError("recorderNotConfigured");
      return;
    }
    let response: Response;
    try {
      response = await fetch(url, { headers: this.authHeaders() });
    } catch (error: unknown) {
      log.error("Recorder download fetch failed", error);
      this.notifyError("recorderErrorDownload");
      throw error;
    }
    if (response.status === 202) {
      ui.notifications?.warn(
        game.i18n?.localize(`${LANG_NAME}.packagingInProgress`) ??
          "Packaging in progress, please wait…",
      );
      throw new Error("Recording is still packaging");
    }
    if (!response.ok) {
      log.error(
        "Recorder download non-OK response",
        response.status,
        response.statusText,
      );
      this.notifyError("recorderErrorDownload");
      throw new Error(
        `download failed (${String(response.status)} ${response.statusText})`,
      );
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Defer revocation so the browser has time to consume the blob URL
      setTimeout(() => { URL.revokeObjectURL(objectUrl); }, 30_000);
    }
  }

  private toWsUrl(httpUrl: string, ticket: string): string {
    let base = httpUrl;
    if (base.startsWith("http://")) base = `ws://${base.slice(7)}`;
    else if (base.startsWith("https://")) base = `wss://${base.slice(8)}`;
    return `${base}/ws?ticket=${encodeURIComponent(ticket)}`;
  }
}
