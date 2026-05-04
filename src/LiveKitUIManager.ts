import { ConnectionQuality, Participant, ConnectionState, Track } from "livekit-client";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { addContextOptions } from "./LiveKitBreakout";
import { Logger } from "./utils/logger";
import type LiveKitClient from "./LiveKitClient";
import type {
  CameraDockSize,
  RecorderState,
} from "../types/avclient-livekit";

const log = new Logger();

const DOCK_MIN_WIDTH = 250;
const DOCK_MIN_HEIGHT = 175;

export default class LiveKitUIManager {
  client: LiveKitClient;
  windowClickListener: EventListener | null = null;

  private dockObserver: ResizeObserver | null = null;
  private observedDockElement: HTMLElement | null = null;
  private readonly persistDockSize: () => void;

  constructor(client: LiveKitClient) {
    this.client = client;
    this.persistDockSize = foundry.utils.debounce(
      this.savePersistedDockSize.bind(this),
      500,
    );
  }

  addConnectionButtons(element: HTMLElement): void {
    // If useExternalAV is enabled, return
    if (this.client.useExternalAV) {
      return;
    }

    const connectButton = document.createElement("button");
    connectButton.type = "button";
    connectButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-toggle-off livekit-control connect hidden";
    connectButton.dataset.tooltip = "";
    connectButton.ariaLabel =
      game.i18n?.localize(`${LANG_NAME}.connect`) ?? "connect";

    const disconnectButton = document.createElement("button");
    disconnectButton.type = "button";
    disconnectButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-toggle-on livekit-control disconnect hidden";
    disconnectButton.dataset.tooltip = "";
    disconnectButton.ariaLabel =
      game.i18n?.localize(`${LANG_NAME}.disconnect`) ?? "disconnect";

    connectButton.addEventListener("click", () => {
      connectButton.classList.toggle("disabled", true);
      this.client.avMaster.connect().catch((error: unknown) => {
        log.error("Error connecting:", error);
      });
    });
    element.before(connectButton);

    disconnectButton.addEventListener("click", () => {
      disconnectButton.classList.toggle("disabled", true);
      this.client.avMaster
        .disconnect()
        .then(() => {
          this.client.render();
        })
        .catch((error: unknown) => {
          log.error("Error disconnecting:", error);
        });
    });
    element.before(disconnectButton);

    if (this.client.liveKitRoom?.state === ConnectionState.Connected) {
      disconnectButton.classList.toggle("hidden", false);
    } else {
      connectButton.classList.toggle("hidden", false);
    }

    // Add recorder controls (GM-only, only when configured)
    this.addRecorderButtons(element);
  }

  /**
   * Inject the record/stop buttons into the local user's camera dock. The
   * buttons are only shown to GMs while the recorder service is configured.
   */
  addRecorderButtons(element: HTMLElement): void {
    if (this.client.useExternalAV) return;
    if (!game.user?.isGM) return;
    if (!this.client.recorder.isConfigured()) return;

    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-circle livekit-control record";
    recordButton.dataset.tooltip = "";
    recordButton.ariaLabel =
      game.i18n.localize(`${LANG_NAME}.recordStart`);
    recordButton.addEventListener("click", () => {
      this.onRecordClick().catch((error: unknown) => {
        log.error("Error starting recording:", error);
      });
    });
    element.before(recordButton);

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-stop livekit-control record-stop hidden";
    stopButton.dataset.tooltip = "";
    stopButton.ariaLabel =
      game.i18n.localize(`${LANG_NAME}.recordStop`);
    stopButton.addEventListener("click", () => {
      this.onStopClick().catch((error: unknown) => {
        log.error("Error stopping recording:", error);
      });
    });
    element.before(stopButton);

    // Sync state for any active recording the GM may be resuming
    this.setRecordButtonState(
      this.client.recorder.state,
      this.client.recorder.activeSessionId,
    );
  }

  private async onRecordClick(): Promise<void> {
    if (!this.client.recorder.isConfigured()) {
      ui.notifications?.warn(
        game.i18n?.localize(`${LANG_NAME}.recorderNotConfigured`) ??
          "Recorder service is not configured.",
      );
      return;
    }
    try {
      await this.client.recorder.startRecording();
    } catch (error) {
      log.error("Could not start recording:", error);
      ui.notifications?.error(
        game.i18n?.localize(`${LANG_NAME}.recorderErrorStart`) ??
          "Could not start recording.",
      );
    }
  }

  private async onStopClick(): Promise<void> {
    const sessionId = this.client.recorder.activeSessionId;
    if (!sessionId) {
      log.warn("Stop clicked without an active session id");
      return;
    }
    const choice = await this.promptStopChoice();
    if (choice === "cancel") return;
    if (choice === "delete") {
      try {
        await this.client.recorder.stopRecording();
        await this.client.recorder.deleteRecording(sessionId);
      } catch (error) {
        log.error("Error during stop+delete flow:", error);
        ui.notifications?.error(
          game.i18n?.localize(`${LANG_NAME}.recorderErrorStop`) ??
            "Could not stop recording.",
        );
      }
      return;
    }
    // choice === "save"
    try {
      const packagingDone = this.client.recorder.awaitPackaging(sessionId);
      await this.client.recorder.stopRecording();
      ui.notifications?.info(
        game.i18n?.localize(`${LANG_NAME}.packagingInProgress`) ??
          "Packaging in progress, please wait…",
      );
      await packagingDone;
      await this.promptDownload(sessionId);
    } catch (error) {
      log.error("Error during stop+save flow:", error);
      ui.notifications?.error(
        game.i18n?.localize(`${LANG_NAME}.recorderErrorStop`) ??
          "Could not stop recording.",
      );
    }
  }

  private async promptStopChoice(): Promise<"save" | "delete" | "cancel"> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result: unknown = await (foundry.applications.api.DialogV2 as any).wait({
        window: { title: `${LANG_NAME}.stopDialogTitle` },
        content: `<p>${
          game.i18n?.localize(`${LANG_NAME}.stopDialogContent`) ??
          "Save or delete this recording?"
        }</p>`,
        buttons: [
          {
            action: "save",
            label: `${LANG_NAME}.stopDialogSave`,
            icon: "fa-solid fa-floppy-disk",
            default: true,
            callback: () => "save",
          },
          {
            action: "delete",
            label: `${LANG_NAME}.stopDialogDelete`,
            icon: "fa-solid fa-trash",
            callback: () => "delete",
          },
          {
            action: "cancel",
            label: `${LANG_NAME}.stopDialogCancel`,
            icon: "fa-solid fa-xmark",
            callback: () => "cancel",
          },
        ],
        rejectClose: false,
      });
      if (result === "save" || result === "delete") {
        return result;
      }
      return "cancel";
    } catch (error: unknown) {
      log.warn("Stop dialog error or dismissed:", error);
      return "cancel";
    }
  }

  private async promptDownload(sessionId: string): Promise<void> {
    const recorder = this.client.recorder;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const format: unknown = await (foundry.applications.api.DialogV2 as any).wait({
        window: { title: `${LANG_NAME}.downloadDialogTitle` },
        content: `<p>${
          game.i18n?.localize(`${LANG_NAME}.downloadDialogContent`) ??
          "Choose a download format:"
        }</p>`,
        buttons: [
          {
            action: "wav",
            label: `${LANG_NAME}.downloadWav`,
            icon: "fa-solid fa-file-audio",
            default: true,
            callback: async () => {
              await recorder.downloadWav(sessionId);
              return "wav";
            },
          },
          {
            action: "zip",
            label: `${LANG_NAME}.downloadZip`,
            icon: "fa-solid fa-file-zipper",
            callback: async () => {
              await recorder.downloadZip(sessionId);
              return "zip";
            },
          },
          {
            action: "close",
            label: `${LANG_NAME}.downloadClose`,
            icon: "fa-solid fa-xmark",
            callback: () => "close",
          },
        ],
        rejectClose: false,
      });

      if (format !== "wav" && format !== "zip") return;

      const shouldDelete = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${LANG_NAME}.deleteAfterDownloadTitle` },
        content: `<p>${
          game.i18n?.localize(`${LANG_NAME}.deleteAfterDownloadContent`) ??
          "Delete this recording from the server?"
        }</p>`,
        rejectClose: false,
      });
      if (shouldDelete) {
        await recorder.deleteRecording(sessionId);
      }
    } catch (error: unknown) {
      log.warn("Download dialog error or cancelled:", error);
    }
  }

  /**
   * Update the record/stop button visibility and disabled state based on the
   * recorder's current state. Called by `LiveKitRecorder` whenever its state
   * changes.
   */
  setRecordButtonState(state: RecorderState, _sessionId: string | null): void {
    void _sessionId;
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${game.user?.id ?? ""}"]`,
    );
    if (!userCameraView) return;
    const recordButton = userCameraView.querySelector(
      ".livekit-control.record",
    );
    const stopButton = userCameraView.querySelector(
      ".livekit-control.record-stop",
    );
    if (
      !(recordButton instanceof HTMLElement) ||
      !(stopButton instanceof HTMLElement)
    ) {
      return;
    }

    switch (state) {
      case "idle":
        recordButton.classList.remove("hidden", "disabled", "recording");
        stopButton.classList.add("hidden");
        stopButton.classList.remove("disabled");
        break;
      case "recording":
        recordButton.classList.remove("hidden");
        recordButton.classList.add("disabled", "recording");
        stopButton.classList.remove("hidden", "disabled");
        break;
      case "stopping":
        recordButton.classList.add("hidden");
        stopButton.classList.remove("hidden");
        stopButton.classList.add("disabled");
        break;
      case "packaging":
        recordButton.classList.add("hidden");
        stopButton.classList.add("hidden");
        break;
    }
  }

  /**
   * Notification hook from `LiveKitRecorder` when the WAV is ready. We let
   * users know via a UI notification; downloads are triggered explicitly via
   * the stop -> save flow's `awaitPackaging` await.
   */
  onRecordingPackaged(_sessionId: string): void {
    void _sessionId;
    ui.notifications?.info(
      game.i18n?.localize(`${LANG_NAME}.recordingPackaged`) ??
        "Recording is ready for download.",
    );
  }

  addConnectionQualityIndicator(userId: string): void {
    if (!game.settings?.get(MODULE_NAME, "displayConnectionQuality")) {
      // Connection quality indicator is not enabled
      return;
    }

    // Get the user camera view and player name bar
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${userId}"]`,
    );
    const userNameBar = userCameraView?.querySelector(".player-name");

    if (userCameraView?.querySelector(".connection-quality-indicator")) {
      // Connection quality indicator already exists
      return;
    }

    const connectionQualityIndicator = $(
      `<div class="connection-quality-indicator unknown" title="${
        game.i18n?.localize(
        `${LANG_NAME}.connectionQuality.${ConnectionQuality.Unknown}`,
      ) ?? "Connection Quality Unknown"
      }"></div>`,
    );

    if (userNameBar instanceof Element) {
      $(userNameBar).after(connectionQualityIndicator);
    }

    this.setConnectionQualityIndicator(userId);
  }

  onAudioPlaybackStatusChanged(canPlayback: boolean): void {
    if (!canPlayback) {
      log.warn("Cannot play audio/video, waiting for user interaction");
      this.windowClickListener =
        this.windowClickListener ?? this.onWindowClick.bind(this);
      window.addEventListener("click", this.windowClickListener);
    }
  }

  onConnectionQualityChanged(quality: string, participant: Participant) {
    log.debug("onConnectionQualityChanged:", quality, participant);

    if (!game.settings?.get(MODULE_NAME, "displayConnectionQuality")) {
      // Connection quality indicator is not enabled
      return;
    }

    const fvttUserId = this.client.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Quality changed participant",
        participant,
        "is not an FVTT user",
      );
      return;
    }

    this.setConnectionQualityIndicator(fvttUserId, quality);
  }

  onGetUserContextOptions(
    _playersApp: foundry.applications.ui.Players,
    contextOptions: foundry.applications.ux.ContextMenu.Entry<HTMLElement>[],
  ): void {
    // Don't add breakout options if AV is disabled
    if (
      this.client.settings.get("world", "mode") ===
      foundry.av.AVSettings.AV_MODES.DISABLED
    ) {
      return;
    }

    addContextOptions(contextOptions, this.client);
  }

  onIsSpeakingChanged(userId: string | undefined, speaking: boolean): void {
    if (userId) {
      // @ts-expect-error - ui.webrtc.setUserIsSpeaking is not in foundry-vtt-types yet
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      ui.webrtc?.setUserIsSpeaking(userId, speaking);
    }
  }

  onRenderCameraViews(
    _cameraviews: foundry.applications.apps.av.CameraViews,
    html: HTMLElement,
  ): void {
    // Apply persisted dock size and (idempotently) install the resize observer
    this.applyStoredDockSize(html);
    this.installDockResizeObserver(html);

    const userId = game.user?.id;
    if (!userId) {
      log.error("No user ID found; cannot render camera views");
      return;
    }
    const cameraBox = html.querySelector(
      `[data-user="${userId}"].user-controls`,
    );
    // Look for existing connection buttons (only the connect/disconnect
    // buttons; recorder controls may be absent if recorder config changes
    // at runtime, so we still re-run addConnectionButtons in that case)
    if (
      cameraBox?.querySelector(
        ".livekit-control.connect, .livekit-control.disconnect",
      )
    ) {
      return;
    }
    const element = cameraBox?.querySelector('[data-action="configure"]');
    if (!(element instanceof HTMLElement)) {
      log.warn("Can't find CameraView configure element", element);
      return;
    }
    this.addConnectionButtons(element);
  }

  /* -------------------------------------------- */
  /*  Camera dock size persistence                */
  /* -------------------------------------------- */

  /**
   * Read the persisted dock size and apply it to `#camera-views`. Skipped
   * when the dock is minimized or when the stored value is below the CSS
   * min thresholds.
   */
  applyStoredDockSize(html: HTMLElement): void {
    const dock = this.findDockElement(html);
    if (!dock || dock.classList.contains("minimized")) return;
    const stored = (game.settings?.get(MODULE_NAME, "cameraDockSize") ??
      {});
    if (
      typeof stored.width === "number" &&
      stored.width >= DOCK_MIN_WIDTH &&
      dock.classList.contains("vertical")
    ) {
      dock.style.width = `${String(stored.width)}px`;
    }
    if (
      typeof stored.height === "number" &&
      stored.height >= DOCK_MIN_HEIGHT &&
      dock.classList.contains("horizontal")
    ) {
      dock.style.height = `${String(stored.height)}px`;
    }
  }

  installDockResizeObserver(html: HTMLElement): void {
    const dock = this.findDockElement(html);
    if (!dock) return;
    if (this.observedDockElement === dock && this.dockObserver) return;
    if (this.dockObserver) {
      this.dockObserver.disconnect();
    }
    this.dockObserver = new ResizeObserver(() => { this.persistDockSize(); });
    this.dockObserver.observe(dock);
    this.observedDockElement = dock;
  }

  disposeDockResizeObserver(): void {
    if (this.dockObserver) {
      this.dockObserver.disconnect();
      this.dockObserver = null;
    }
    this.observedDockElement = null;
  }

  private findDockElement(html: HTMLElement): HTMLElement | null {
    if (html.id === "camera-views") return html;
    const found = html.querySelector("#camera-views");
    return found instanceof HTMLElement ? found : null;
  }

  private savePersistedDockSize(): void {
    const dock = this.observedDockElement;
    if (!dock || dock.classList.contains("minimized")) return;
    const next: CameraDockSize = {};
    if (dock.classList.contains("vertical")) {
      next.width = dock.offsetWidth;
    }
    if (dock.classList.contains("horizontal")) {
      next.height = dock.offsetHeight;
    }
    if (next.width === undefined && next.height === undefined) return;
    const current = (game.settings?.get(MODULE_NAME, "cameraDockSize") ??
      {});
    if (current.width === next.width && current.height === next.height) {
      return;
    }
    game.settings
      ?.set(MODULE_NAME, "cameraDockSize", { ...current, ...next })
      .catch((error: unknown) => {
        log.error("Error saving camera dock size:", error);
      });
  }

  /**
   * Change volume control for a stream
   * @param {Event} event   The originating change event from interaction with the range input
   */
  onVolumeChange(event: Event): void {
    const input = event.currentTarget;
    if (
      !(input instanceof foundry.applications.elements.HTMLRangePickerElement)
    ) {
      log.warn(
        "Volume change event did not originate from a range picker element",
      );
      return;
    }
    const box = input.closest(".camera-view");
    const volume = foundry.audio.AudioHelper.inputToVolume(input.value);
    if (!(box instanceof HTMLElement)) {
      log.warn("Volume change event did not originate from a camera view box");
      return;
    }
    const audioElements: HTMLCollection = box.getElementsByTagName("audio");
    for (const audioElement of audioElements) {
      if (audioElement instanceof HTMLAudioElement) {
        audioElement.volume = volume;
      }
    }

    // HACK: Needed to fix a bug in FVTT v13
    if (box.dataset.user) {
      this.client.settings.set("client", `users.${box.dataset.user}.volume`, volume);
    }
  }

  onWindowClick(): void {
    if (this.windowClickListener) {
      window.removeEventListener("click", this.windowClickListener);
      this.client.render();
    }
  }

  setConnectionButtons(connected: boolean): void {
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${game.user?.id ?? ""}"]`,
    );

    if (userCameraView) {
      const connectButton = userCameraView.querySelector(
        ".livekit-control.connect",
      );
      const disconnectButton = userCameraView.querySelector(
        ".livekit-control.disconnect",
      );

      connectButton?.classList.toggle("hidden", connected);
      connectButton?.classList.toggle("disabled", false);
      disconnectButton?.classList.toggle("hidden", !connected);
      disconnectButton?.classList.toggle("disabled", false);
    }
  }

  setConnectionQualityIndicator(userId: string, quality?: string): void {
    // Get the user camera view and connection quality indicator
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${userId}"]`,
    );
    const connectionQualityIndicator = userCameraView?.querySelector(
      ".connection-quality-indicator",
    );

    quality ??=
      this.client.liveKitParticipants.get(userId)?.connectionQuality ??
      ConnectionQuality.Unknown;

    if (connectionQualityIndicator instanceof HTMLDivElement) {
      // Remove all existing quality classes
      connectionQualityIndicator.classList.remove(
        ...Object.values(ConnectionQuality),
      );

      // Add the correct quality class
      connectionQualityIndicator.classList.add(quality);

      // Set the hover title
      connectionQualityIndicator.title =
        game.i18n?.localize(`${LANG_NAME}.connectionQuality.${quality}`) ??
        quality;
    }
  }

  /**
   * Obtain a reference to the video.user-audio which plays the audio channel for a requested
   * Foundry User.
   * If the element doesn't exist, but a video element does, it will create it.
   * @param {string} userId                   The ID of the User entity
   * @param {HTMLVideoElement} videoElement   The HTMLVideoElement of the user
   * @return {HTMLAudioElement|null}
   */
  getUserAudioElement(
    userId: string,
    videoElement: HTMLVideoElement | null = null,
    audioType: Track.Source,
  ): HTMLAudioElement | null {
    // Find an existing audio element
    let audioElement = ui.webrtc?.element.querySelector(
      `.camera-view[data-user="${userId}"] audio.user-${audioType}-audio`,
    );

    // If one doesn't exist, create it
    if (!audioElement && videoElement) {
      audioElement = document.createElement("audio");
      audioElement.className = `user-${audioType}-audio`;
      if (audioElement instanceof HTMLAudioElement) {
        audioElement.autoplay = true;
      }
      videoElement.after(audioElement);

      // Bind volume control for microphone audio
      const volumeSlider =
        videoElement.parentElement?.parentElement?.querySelector(
          ".webrtc-volume-slider",
        );
      volumeSlider?.addEventListener("change", this.onVolumeChange.bind(this));
    }

    if (audioElement instanceof HTMLAudioElement) {
      return audioElement;
    }

    // The audio element was not found or created
    return null;
  }
}
