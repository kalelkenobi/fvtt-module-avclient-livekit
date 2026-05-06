import { ConnectionQuality, Participant, ConnectionState, Track } from "livekit-client";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { addContextOptions } from "./LiveKitBreakout";
import { Logger } from "./utils/logger";
import type LiveKitClient from "./LiveKitClient";
import type { RecorderState } from "../types/avclient-livekit";

const log = new Logger();

const DOCK_MIN_WIDTH = 250;
const DOCK_MIN_HEIGHT = 175;

export default class LiveKitUIManager {
  client: LiveKitClient;
  windowClickListener: EventListener | null = null;

  private dockObserver: ResizeObserver | null = null;
  private dockStyleObserver: MutationObserver | null = null;
  private observedDockElement: HTMLElement | null = null;
  private applyingHeight = false;
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
   * Inject a single record-toggle button into the local user's camera dock.
   * Only shown to GMs while the recorder service is configured. Button icon
   * and state classes change based on the recorder's current state.
   */
  addRecorderButtons(element: HTMLElement): void {
    if (this.client.useExternalAV) return;
    if (!game.user?.isGM) return;
    if (!this.client.recorder.isConfigured()) return;

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw livekit-control record-toggle";
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
      await this.client.recorder.stopRecording();
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
          "Download the session recording as a ZIP file?"
        }</p>`,
        buttons: [
          {
            action: "zip",
            label: `${LANG_NAME}.downloadZip`,
            icon: "fa-solid fa-file-zipper",
            default: true,
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

      if (format !== "zip") return;

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
   * Update the record-toggle button icon, classes, and label based on the
   * recorder's current state. Called by `LiveKitRecorder` on every state
   * transition.
   */
  setRecordButtonState(state: RecorderState, _sessionId: string | null): void {
    void _sessionId;
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${game.user?.id ?? ""}"]`,
    );
    if (!userCameraView) return;
    const toggle = userCameraView.querySelector(
      ".livekit-control.record-toggle",
    );
    if (!(toggle instanceof HTMLElement)) return;

    const iconClasses = ["fa-circle", "fa-stop", "fa-spinner", "fa-spin"];
    const stateClasses = ["idle", "recording", "stopping"];
    toggle.classList.remove(...iconClasses, ...stateClasses, "disabled");

    const t = game.i18n?.localize.bind(game.i18n) ?? ((k: string) => k);
    switch (state) {
      case "idle":
        toggle.classList.add("fa-circle", "idle");
        toggle.ariaLabel = t(`${LANG_NAME}.recordStart`) || "Start recording";
        break;
      case "recording":
        toggle.classList.add("fa-stop", "recording");
        toggle.ariaLabel = t(`${LANG_NAME}.recordStop`) || "Stop recording";
        break;
      case "stopping":
        toggle.classList.add("fa-spinner", "fa-spin", "stopping", "disabled");
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
    const dock = this.findDockElement(html);

    // Apply persisted dock size and install observers
    this.applyHorizontalDockHeight(dock);
    this.installDockResizeObserver(dock);
    this.installDockStyleObserver(dock);

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
   * For horizontal (top/bottom) docks, apply our persisted height after the
   * current render cycle completes so we don't race with Foundry's own
   * dimension apply. Vertical (left/right) docks are handled by Foundation
   * through the built-in `client.dockWidth` setting.
   */
  private applyHorizontalDockHeight(dock: HTMLElement | null): void {
    if (!dock || dock.classList.contains("minimized")) return;
    if (!dock.classList.contains("horizontal")) return;
    const stored: number = game.settings?.get(MODULE_NAME, "cameraDockHeight") ?? 0;
    if (stored < DOCK_MIN_HEIGHT) return;
    requestAnimationFrame(() => {
      const current = dock.style.height
        ? parseFloat(dock.style.height)
        : NaN;
      if (!Number.isFinite(current) || current !== stored) {
        this.applyingHeight = true;
        dock.style.height = `${String(stored)}px`;
        requestAnimationFrame(() => { this.applyingHeight = false; });
      }
    });
  }

  /**
   * Idempotently install a `ResizeObserver` that persists the user's dock
   * dimension on every resize. Width is written to Foundry's native
   * `client.dockWidth`; height is written to our `cameraDockHeight` setting.
   */
  private installDockResizeObserver(dock: HTMLElement | null): void {
    if (!dock) return;
    if (this.observedDockElement === dock && this.dockObserver) return;
    if (this.dockObserver) {
      this.dockObserver.disconnect();
    }
    this.dockObserver = new ResizeObserver(() => { this.persistDockSize(); });
    this.dockObserver.observe(dock);
    this.observedDockElement = dock;
  }

  /**
   * For horizontal docks, install a `MutationObserver` that re-applies
   * our persisted height whenever Foundry overwrites the inline style.
   * Not needed for vertical docks — Foundry respects `client.dockWidth`
   * natively.
   */
  private installDockStyleObserver(dock: HTMLElement | null): void {
    if (!dock?.classList.contains("horizontal")) {
      if (this.dockStyleObserver) {
        this.dockStyleObserver.disconnect();
        this.dockStyleObserver = null;
      }
      return;
    }
    if (this.dockStyleObserver) return;

    this.dockStyleObserver = new MutationObserver((mutations) => {
      if (this.applyingHeight) return;
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "style") {
          const stored: number = game.settings?.get(
            MODULE_NAME,
            "cameraDockHeight",
          ) ?? 0;
          if (stored < DOCK_MIN_HEIGHT) return;
          const current = dock.style.height
            ? parseFloat(dock.style.height)
            : NaN;
          if (!Number.isFinite(current) || current !== stored) {
            this.applyingHeight = true;
            dock.style.height = `${String(stored)}px`;
            requestAnimationFrame(() => { this.applyingHeight = false; });
          }
        }
      }
    });
    this.dockStyleObserver.observe(dock, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  disposeDockObservers(): void {
    if (this.dockObserver) {
      this.dockObserver.disconnect();
      this.dockObserver = null;
    }
    if (this.dockStyleObserver) {
      this.dockStyleObserver.disconnect();
      this.dockStyleObserver = null;
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
    if (dock.classList.contains("vertical")) {
      const w = dock.offsetWidth;
      if (w >= DOCK_MIN_WIDTH) {
        const current: number = this.client.settings.get(
          "client",
          "dockWidth",
        ) as number;
        if (current !== w) {
          this.client.settings.set("client", "dockWidth", w);
        }
      }
    } else if (dock.classList.contains("horizontal")) {
      const h = dock.offsetHeight;
      if (h >= DOCK_MIN_HEIGHT) {
        const current: number = game.settings?.get(
          MODULE_NAME,
          "cameraDockHeight",
        ) ?? 0;
        if (current !== h) {
          game.settings
            ?.set(MODULE_NAME, "cameraDockHeight", h)
            .catch((error: unknown) => {
              log.error("Error saving dock height:", error);
            });
        }
      }
    }
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
