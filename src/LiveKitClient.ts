import {
  Participant,
  ParticipantEvent,
  RemoteParticipant,
  Room,
  RoomEvent,
  RoomOptions,
  ConnectionState,
  DisconnectReason,
  RemoteAudioTrack,
  VideoTrack,
  Track,
} from "livekit-client";
import { LANG_NAME } from "./utils/constants";
import LiveKitAVClient from "./LiveKitAVClient";
import { SocketMessage } from "../types/avclient-livekit";
import { breakout } from "./LiveKitBreakout";
import { Logger } from "./utils/logger";
import LiveKitTrackManager from "./LiveKitTrackManager";
import LiveKitUIManager from "./LiveKitUIManager";

const log = new Logger();

export enum InitState {
  Uninitialized = "uninitialized",
  Initializing = "initializing",
  Initialized = "initialized",
}

export default class LiveKitClient {
  avMaster: foundry.av.AVMaster;
  liveKitAvClient: LiveKitAVClient;
  settings: foundry.av.AVSettings;
  render: () => void;

  audioBroadcastEnabled = false;
  breakoutRoom: string | undefined;
  connectionState: ConnectionState = ConnectionState.Disconnected;
  initState: InitState = InitState.Uninitialized;
  liveKitParticipants = new Map<string, Participant>();
  liveKitRoom: Room | null = null;
  useExternalAV = false;

  trackManager: LiveKitTrackManager;
  uiManager: LiveKitUIManager;

  constructor(liveKitAvClient: LiveKitAVClient) {
    this.avMaster = liveKitAvClient.master;
    this.liveKitAvClient = liveKitAvClient;
    this.settings = liveKitAvClient.settings;

    this.render = foundry.utils.debounce(
      this.avMaster.render.bind(this.liveKitAvClient),
      2000,
    );

    this.trackManager = new LiveKitTrackManager(this);
    this.uiManager = new LiveKitUIManager(this);
  }

  /* -------------------------------------------- */
  /*  Compatibility Proxy Getters                 */
  /* -------------------------------------------- */

  get audioTrack() { return this.trackManager.audioTrack; }
  get primaryAudioTrack() { return this.trackManager.primaryAudioTrack; }
  get secondaryAudioTrack() { return this.trackManager.secondaryAudioTrack; }
  get videoTrack() { return this.trackManager.videoTrack; }
  get screenTracks() { return this.trackManager.screenTracks; }
  get audioContext() { return this.trackManager.audioContext; }
  get mixedMediaStream() { return this.trackManager.mixedMediaStream; }

  /* -------------------------------------------- */
  /*  LiveKit Internal methods                    */
  /* -------------------------------------------- */

  addAllParticipants(): void {
    if (!this.liveKitRoom) {
      log.warn(
        "Attempting to add participants before the LiveKit room is available",
      );
      return;
    }

    // Add our user to the participants list
    const userId = game.user?.id;
    if (userId) {
      this.liveKitParticipants.set(userId, this.liveKitRoom.localParticipant);
    }

    // Set up all other users
    this.liveKitRoom.remoteParticipants.forEach(
      (participant: RemoteParticipant) => {
        this.onParticipantConnected(participant);
      },
    );
  }

  getParticipantFVTTUser(participant: Participant): User | undefined {
    const { fvttUserId } = JSON.parse(participant.metadata ?? "{}") as {
      fvttUserId: string;
    };
    return game.users?.get(fvttUserId);
  }

  getParticipantUseExternalAV(participant: Participant): boolean {
    const { useExternalAV } = JSON.parse(
      participant.metadata ?? "{ false }",
    ) as {
      useExternalAV: boolean;
    };
    return useExternalAV;
  }

  getUserStatistics(userId: string): string {
    const participant = this.liveKitParticipants.get(userId);
    let totalBitrate = 0;
    if (!participant) {
      return "";
    }

    for (const t of participant.trackPublications.values()) {
      if (t.track) {
        totalBitrate += t.track.currentBitrate;
      }
    }
    let bitrate = "";
    if (totalBitrate > 0) {
      bitrate = `${Math.round(totalBitrate / 1024).toLocaleString()} kbps`;
    }

    return bitrate;
  }

  getAllUserStatistics(): Map<string, string> {
    const userStatistics = new Map<string, string>();
    this.liveKitParticipants.forEach((_participant, userId) => {
      userStatistics.set(userId, this.getUserStatistics(userId));
    });
    return userStatistics;
  }

  initializeRoom(): void {
    // set the LiveKit publish defaults
    const liveKitPublishDefaults = this.trackManager.trackPublishOptions;

    // Set the livekit room options
    const liveKitRoomOptions: RoomOptions = {
      adaptiveStream: liveKitPublishDefaults.simulcast,
      dynacast: liveKitPublishDefaults.simulcast,
      publishDefaults: liveKitPublishDefaults,
    };

    // Create and configure the room
    this.liveKitRoom = new Room(liveKitRoomOptions);

    // Set up room callbacks
    this.setRoomCallbacks();
  }

  async onConnected(): Promise<void> {
    log.debug("Client connected");

    // Set up local participant callbacks
    this.setLocalParticipantCallbacks();

    // Add users to participants list
    this.addAllParticipants();

    // Set connection button state
    this.uiManager.setConnectionButtons(true);

    // Publish local tracks
    if (this.trackManager.audioTrack) {
      await this.liveKitRoom?.localParticipant.publishTrack(
        this.trackManager.audioTrack,
        this.trackManager.trackPublishOptions,
      );
    }
    if (this.trackManager.videoTrack) {
      await this.liveKitRoom?.localParticipant.publishTrack(
        this.trackManager.videoTrack,
        this.trackManager.trackPublishOptions,
      );
    }
  }

  onDisconnected(reason?: DisconnectReason): void {
    log.debug("Client disconnected", { reason });
    let disconnectWarning =
      game.i18n?.localize(`${LANG_NAME}.onDisconnected`) ?? "onDisconnected";
    if (reason) {
      disconnectWarning += `: ${DisconnectReason[reason]}`;
    }
    ui.notifications?.warn(disconnectWarning);

    // Clear the participant map
    this.liveKitParticipants.clear();

    // Set connection buttons state
    this.uiManager.setConnectionButtons(false);

    this.connectionState = ConnectionState.Disconnected;

    // TODO: Add some incremental back-off reconnect logic here
  }

  onParticipantConnected(participant: RemoteParticipant): void {
    log.debug("onParticipantConnected:", participant);

    const fvttUser = this.getParticipantFVTTUser(participant);

    if (!fvttUser?.id) {
      log.error(
        "Joining participant",
        participant,
        "is not an FVTT user; cannot display them",
      );
      return;
    }

    if (!fvttUser.active) {
      // Force the user to be active. If they are signing in to meeting, they should be online.
      log.warn(
        "Joining user",
        fvttUser.id,
        "is not listed as active. Setting to active.",
      );
      fvttUser.active = true;
      ui.players?.render().catch((error: unknown) => {
        log.error("Error rendering players view:", error);
      });
    }

    // Save the participant to the ID mapping
    this.liveKitParticipants.set(fvttUser.id, participant);

    // Clear breakout room cache if user is joining the main conference
    if (!this.breakoutRoom) {
      this.settings.set(
        "client",
        `users.${fvttUser.id}.liveKitBreakoutRoom`,
        "",
      );
    }

    // Set up remote participant callbacks
    this.setRemoteParticipantCallbacks(participant);

    // Call a debounced render
    this.render();
  }

  onParticipantDisconnected(participant: RemoteParticipant): void {
    log.debug("onParticipantDisconnected:", participant);

    // Remove the participant from the ID mapping
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn("Leaving participant", participant, "is not an FVTT user");
      return;
    }

    this.liveKitParticipants.delete(fvttUserId);

    // Clear breakout room cache if user is leaving a breakout room
    if (
      this.settings.get("client", `users.${fvttUserId}.liveKitBreakoutRoom`) ===
      this.liveKitAvClient.room &&
      this.liveKitAvClient.room === this.breakoutRoom
    ) {
      this.settings.set(
        "client",
        `users.${fvttUserId}.liveKitBreakoutRoom`,
        "",
      );
    }

    // Call a debounced render
    this.render();
  }

  onReconnected(): void {
    log.info("Reconnect issued");
    // Re-render just in case users changed
    this.render();
  }

  onReconnecting(): void {
    log.warn("Reconnecting to room");
    ui.notifications?.warn(
      game.i18n?.localize("WEBRTC.ConnectionLostWarning") ??
      "ConnectionLostWarning",
    );
  }

  onSocketEvent(message: SocketMessage, userId: string): void {
    log.debug("Socket event:", message, "from:", userId);
    switch (message.action) {
      case "breakout":
        // Allow only GMs to issue breakout requests. Ignore requests that aren't for us.
        if (
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          game.users?.get(userId)?.isGM &&
          (!message.userId || message.userId === game.user.id)
        ) {
          breakout(message.breakoutRoom, this);
        }
        break;
      case "connect":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.avMaster.connect().catch((error: unknown) => {
            log.error("Error connecting:", error);
          });
        } else {
          log.warn("Connect socket event from non-GM user; ignoring");
        }
        break;
      case "disconnect":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.avMaster
            .disconnect()
            .then(() => {
              this.render();
            })
            .catch((error: unknown) => {
              log.error("Error disconnecting:", error);
            });
        } else {
          log.warn("Disconnect socket event from non-GM user; ignoring");
        }
        break;
      case "render":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.render();
        } else {
          log.warn("Render socket event from non-GM user; ignoring");
        }
        break;
      default:
        log.warn("Unknown socket event:", message);
    }
  }

  async sendJoinMessage(liveKitServer: string, accessToken: string) {
    // Create the url for user to join the external LiveKit web client
    const params = new URLSearchParams({
      liveKitUrl: `wss://${liveKitServer}`,
      token: accessToken,
    });
    const url = `https://meet.livekit.io/custom?${params.toString()}`;

    await foundry.applications.api.DialogV2.confirm({
      window: { title: `${LANG_NAME}.externalAVJoinTitle` },
      content: `<p>${
        game.i18n?.localize(`${LANG_NAME}.externalAVJoinMessage`) ??
        "externalAVJoinMessage"
        }</p>`,
      yes: {
        label: `${LANG_NAME}.externalAVJoinButton`,
        icon: "fa-solid fa-check",
        callback: () => window.open(url),
      },
      no: {
        label: `${LANG_NAME}.externalAVIgnoreButton`,
        icon: "fa-solid fa-xmark",
        callback: () => {
          log.info("Ignoring external LiveKit join request");
        },
      },
    });
  }

  setLocalParticipantCallbacks(): void {
    this.liveKitRoom?.localParticipant
      .on(
        ParticipantEvent.IsSpeakingChanged,
        this.uiManager.onIsSpeakingChanged.bind(this.uiManager, game.user?.id),
      )
      .on(ParticipantEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("Local ParticipantEvent ParticipantMetadataChanged:", args);
      })
      .on(ParticipantEvent.TrackPublished, (...args) => {
        log.debug("Local ParticipantEvent TrackPublished:", args);
      })
      .on(ParticipantEvent.TrackSubscriptionStatusChanged, (...args) => {
        log.debug(
          "Local ParticipantEvent TrackSubscriptionStatusChanged:",
          args,
        );
      });
  }

  setRemoteParticipantCallbacks(participant: RemoteParticipant): void {
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Participant",
        participant,
        "is not an FVTT user; skipping setRemoteParticipantCallbacks",
      );
      return;
    }

    participant
      .on(
        ParticipantEvent.IsSpeakingChanged,
        this.uiManager.onIsSpeakingChanged.bind(this.uiManager, fvttUserId),
      )
      .on(ParticipantEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("Remote ParticipantEvent ParticipantMetadataChanged:", args);
      });
  }

  setRoomCallbacks(): void {
    if (!this.liveKitRoom) {
      log.warn(
        "Attempted to set up room callbacks before the LiveKit room is ready",
      );
      return;
    }

    // Set up event callbacks
    this.liveKitRoom
      .on(
        RoomEvent.AudioPlaybackStatusChanged,
        this.uiManager.onAudioPlaybackStatusChanged.bind(this.uiManager),
      )
      .on(
        RoomEvent.ParticipantConnected,
        this.onParticipantConnected.bind(this),
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        this.onParticipantDisconnected.bind(this),
      )
      .on(RoomEvent.TrackSubscribed, this.trackManager.onTrackSubscribed.bind(this.trackManager))
      .on(RoomEvent.TrackSubscriptionFailed, (...args) => {
        log.error("RoomEvent TrackSubscriptionFailed:", args);
      })
      .on(RoomEvent.TrackUnpublished, (...args) => {
        log.debug("RoomEvent TrackUnpublished:", args);
      })
      .on(RoomEvent.TrackUnsubscribed, this.trackManager.onTrackUnSubscribed.bind(this.trackManager))
      .on(RoomEvent.LocalTrackUnpublished, (...args) => {
        log.debug("RoomEvent LocalTrackUnpublished:", args);
      })
      .on(
        RoomEvent.ConnectionQualityChanged,
        this.uiManager.onConnectionQualityChanged.bind(this.uiManager),
      )
      .on(RoomEvent.Disconnected, this.onDisconnected.bind(this))
      .on(RoomEvent.Reconnecting, this.onReconnecting.bind(this))
      .on(RoomEvent.TrackMuted, this.trackManager.onTrackMuteChanged.bind(this.trackManager))
      .on(RoomEvent.TrackUnmuted, this.trackManager.onTrackMuteChanged.bind(this.trackManager))
      .on(RoomEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("RoomEvent ParticipantMetadataChanged:", args);
      })
      .on(RoomEvent.RoomMetadataChanged, (...args) => {
        log.debug("RoomEvent RoomMetadataChanged:", args);
      })
      .on(RoomEvent.Reconnected, this.onReconnected.bind(this));
  }

  /* -------------------------------------------- */
  /*  Compatibility Proxy Methods                 */
  /* -------------------------------------------- */

  async initializeLocalTracks() { await this.trackManager.initializeLocalTracks(); }
  async changeAudioSource(forceStop = false) { await this.trackManager.changeAudioSource(forceStop); }
  async changeVideoSource() { await this.trackManager.changeVideoSource(); }
  setAudioEnabledState(enable: boolean) { this.trackManager.setAudioEnabledState(enable); }
  async shareScreen(enable: boolean) { await this.trackManager.shareScreen(enable); }
  async attachAudioTrack(userId: string, userAudioTrack: RemoteAudioTrack, audioElement: HTMLAudioElement) { await this.trackManager.attachAudioTrack(userId, userAudioTrack, audioElement); }
  attachVideoTrack(userVideoTrack: VideoTrack, videoElement: HTMLVideoElement) { this.trackManager.attachVideoTrack(userVideoTrack, videoElement); }
  getUserAudioTrack(userId: string | undefined) { return this.trackManager.getUserAudioTrack(userId); }
  getUserVideoTrack(userId: string | undefined) { return this.trackManager.getUserVideoTrack(userId); }

  addConnectionButtons(element: HTMLElement) { this.uiManager.addConnectionButtons(element); }
  setConnectionButtons(connected: boolean) { this.uiManager.setConnectionButtons(connected); }
  addConnectionQualityIndicator(userId: string) { this.uiManager.addConnectionQualityIndicator(userId); }
  getUserAudioElement(userId: string, videoElement: HTMLVideoElement | null = null, audioType: Track.Source) { return this.uiManager.getUserAudioElement(userId, videoElement, audioType); }
  
  onRenderCameraViews(cameraviews: foundry.applications.apps.av.CameraViews, html: HTMLElement) { this.uiManager.onRenderCameraViews(cameraviews, html); }
  onGetUserContextOptions(playersApp: foundry.applications.ui.Players, contextOptions: foundry.applications.ux.ContextMenu.Entry<HTMLElement>[]) { this.uiManager.onGetUserContextOptions(playersApp, contextOptions); }
}
