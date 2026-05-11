import { ConnectionQuality, Participant, ConnectionState, Track } from "livekit-client";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { addContextOptions } from "./LiveKitBreakout";
import { Logger } from "./utils/logger";
import type LiveKitClient from "./LiveKitClient";
import type { RecorderState } from "../types/avclient-livekit";

const log = new Logger();

export default class LiveKitUIManager {
  client: LiveKitClient;
  windowClickListener: EventListener | null = null;

  // Track user-driven resizes of the #camera-views dock so they survive
  // re-renders triggered by AVMaster.render(). In-memory only — resets on
  // page reload.
  private cameraDockSize: { width: string; height: string } = {
    width: "",
    height: "",
  };
  private cameraDockResizeObserver: ResizeObserver | null = null;
  private observedDockElement: HTMLElement | null = null;
  private pendingRestoreFrame: number | null = null;

  constructor(client: LiveKitClient) {
    this.client = client;
  }

  /**
   * Restore any captured user resize for the #camera-views dock and ensure a
   * ResizeObserver is attached so subsequent user resizes are remembered.
   *
   * The restore is deferred to the next animation frame because Foundry's
   * CameraViews application calls `_updatePosition` *after* the
   * `renderCameraViews` hook returns, which wipes inline width/height. Running
   * inside rAF puts our restore after that wipe in the same tick.
   */
  private ensureCameraDockResizePersistence(host: HTMLElement): void {
    // (Re-)attach ResizeObserver to #camera-views if needed.
    // ApplicationV2 may replace the node on re-render.
    if (this.observedDockElement !== host) {
      this.cameraDockResizeObserver?.disconnect();
      this.observedDockElement = host;

      this.cameraDockResizeObserver ??= new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const target = entry.target;

        // Don't capture while minimized.
        if (!(target instanceof HTMLElement) || target.classList.contains("minimized")) return;

        // Only capture genuine user-driven sizes; ignore Foundry's reset to "".
        if (target.style.width !== "" || target.style.height !== "") {
          this.cameraDockSize.width = target.style.width;
          this.cameraDockSize.height = target.style.height;
        }
      });

      this.cameraDockResizeObserver.observe(host);
    }

    // Defer restore past CameraViews._updatePosition. Cancel any previously
    // scheduled restore so rapid re-renders don't stack writes.
    if (this.pendingRestoreFrame !== null) {
      cancelAnimationFrame(this.pendingRestoreFrame);
    }
    this.pendingRestoreFrame = requestAnimationFrame(() => {
      this.pendingRestoreFrame = null;

      // A newer render may have replaced the observed element.
      if (this.observedDockElement !== host) return;
      // Don't fight a minimized dock.
      if (host.classList.contains("minimized")) return;
      // Nothing captured yet (first render after page load).
      if (!this.cameraDockSize.width && !this.cameraDockSize.height) return;

      host.style.width = this.cameraDockSize.width;
      host.style.height = this.cameraDockSize.height;
    });
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

  addRecorderButtons(element: HTMLElement): void {
    if (this.client.useExternalAV) return;
    if (!game.user?.isGM) return;
    if (!this.client.recorder.isConfigured()) return;

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-circle livekit-control record-toggle";
    toggleButton.dataset.tooltip = "";
    toggleButton.ariaLabel =
      game.i18n.localize(`${LANG_NAME}.recordStart`);
    toggleButton.addEventListener("click", () => {
      switch (this.client.recorder.state) {
        case "idle":
          this.onRecordClick().catch((error: unknown) => {
            log.error("Error starting recording:", error);
          });
          break;
        case "recording":
          this.onStopClick().catch((error: unknown) => {
            log.error("Error stopping recording:", error);
          });
          break;
        default:
          // stopping — disabled, ignore
      }
    });
    element.before(toggleButton);

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
    
    try {
      await this.client.recorder.stopRecording();
    } catch (error) {
      log.error("Error stopping recording:", error);
      ui.notifications?.error(
        game.i18n?.localize(`${LANG_NAME}.recorderErrorStop`) ??
          "Could not stop recording.",
      );
    }

    if (choice === "delete") {
      try {
        await this.client.recorder.deleteRecording(sessionId);
      } catch (error) {
        log.error("Error deleting recording:", error);
        ui.notifications?.error(
          game.i18n?.localize(`${LANG_NAME}.recorderErrorStop`) ??
            "Could not delete recording.",
        );
      }
      return;
    }
    // choice === "save"
    try {
      await this.client.recorder.downloadZip(sessionId);
    } catch (error) {
      log.error("Error saving recording:", error);
      ui.notifications?.error(
        game.i18n?.localize(`${LANG_NAME}.recorderErrorStop`) ??
          "Could not save recording.",
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

  /**
   * Update the record-toggle button icon, classes, and label based on the
   * recorder's current state. Called by `LiveKitRecorder` on every state
   * transition.
   */
  setRecordButtonState(state: RecorderState, _sessionId: string | null): void {
    void _sessionId;
    const toggle = document.querySelector("#camera-views .user-controls .record-toggle");
    if (!(toggle instanceof HTMLElement)) return;

    const t = game.i18n?.localize.bind(game.i18n) ?? ((k: string) => k);
    switch (state) {
      case "idle":
        toggle.classList.remove("disabled", "recording");
        toggle.ariaLabel = t(`${LANG_NAME}.recordStart`) || "Start recording";
        break;
      case "recording":
        toggle.classList.remove("disabled");
        toggle.classList.add("recording");
        toggle.ariaLabel = t(`${LANG_NAME}.recordStop`) || "Stop recording";
        break;
      case "stopping":
        toggle.classList.remove("recording");
        toggle.classList.add("disabled");
        toggle.ariaLabel =
          t(`${LANG_NAME}.recordingInProgress`) || "Recording in progress";
        break;
    }
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
    
    // Persist user-resized dock dimensions across re-renders. `html` is the
    // CameraViews application root (#camera-views); fall back defensively in
    // case that contract ever changes.
    const dock =
      html.id === "camera-views"
        ? html
        : ((html.closest("#camera-views") as HTMLElement | null) ??
          document.getElementById("camera-views"));
    if (dock instanceof HTMLElement) {
      this.ensureCameraDockResizePersistence(dock);
    }

    const userId = game.user?.id;
    if (!userId) {
      log.error("No user ID found; cannot render camera views");
      return;
    }
    const cameraBox = html.querySelector(
      `[data-user="${userId}"].user-controls`,
    );
    // Look for existing connection buttons
    if (cameraBox?.querySelector(".livekit-control")) {
      return;
    }
    const element = cameraBox?.querySelector('[data-action="configure"]');
    if (!(element instanceof HTMLElement)) {
      log.warn("Can't find CameraView configure element", element);
      return;
    }
    this.addConnectionButtons(element);
  }

  /**
   * Change volume control for a stream
   * @param {Event} event The originating change event from interaction with the range input
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
