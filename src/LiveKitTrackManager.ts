import {
  AudioCaptureOptions,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
  LocalAudioTrack,
  LocalTrack,
  LocalVideoTrack,
  Participant,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Track,
  TrackPublication,
  VideoCaptureOptions,
  VideoPresets43,
  VideoTrack,
  AudioPresets,
  TrackPublishOptions,
  ConnectionState,
} from "livekit-client";
import { MODULE_NAME } from "./utils/constants";
import { Logger } from "./utils/logger";
import { debounceRefreshView } from "./utils/helpers";
import type LiveKitClient from "./LiveKitClient";

const log = new Logger();

export default class LiveKitTrackManager {
  client: LiveKitClient;

  audioTrack: LocalAudioTrack | null = null;
  primaryAudioTrack: LocalAudioTrack | null = null;
  secondaryAudioTrack: LocalAudioTrack | null = null;
  audioContext: AudioContext | null = null;
  mixedMediaStream: MediaStream | null = null;
  videoTrack: LocalVideoTrack | null = null;
  screenTracks: LocalTrack[] = [];

  // Gain nodes for independent volume control of mixed audio sources
  private primaryGainNode: GainNode | null = null;
  private secondaryGainNode: GainNode | null = null;

  constructor(client: LiveKitClient) {
    this.client = client;
  }

  async attachAudioTrack(
    userId: string,
    userAudioTrack: RemoteAudioTrack,
    audioElement: HTMLAudioElement,
  ): Promise<void> {
    if (userAudioTrack.attachedElements.includes(audioElement)) {
      log.debug(
        "Audio track",
        userAudioTrack,
        "already attached to element",
        audioElement,
        "; skipping",
      );
      return;
    }

    // Set audio output device
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (audioElement.sinkId === undefined) {
      log.warn("Your web browser does not support output audio sink selection");
    } else {
      const requestedSink = this.client.settings.get("client", "audioSink");
      // @ts-expect-error - setSinkId is currently an experimental method and not in the defined types
      await audioElement.setSinkId(requestedSink).catch((error: unknown) => {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error(
          "An error occurred when requesting the output audio device:",
          requestedSink,
          message,
        );
      });
    }

    // Detach from any existing elements
    userAudioTrack.detach();

    // Attach the audio track
    userAudioTrack.attach(audioElement);

    // Set the parameters
    let userVolume = this.client.settings.getUser(userId)?.volume;
    if (typeof userVolume === "undefined") {
      userVolume = 1.0;
    }
    audioElement.volume = userVolume;
    audioElement.muted = this.client.settings.get("client", "muteAll") === true;
  }

  attachVideoTrack(
    userVideoTrack: VideoTrack,
    videoElement: HTMLVideoElement,
  ): void {
    if (userVideoTrack.attachedElements.includes(videoElement)) {
      log.debug(
        "Video track",
        userVideoTrack,
        "already attached to element",
        videoElement,
        "; skipping",
      );
      return;
    }

    // Detach from any existing elements
    userVideoTrack.detach();

    // Attach to the video element
    userVideoTrack.attach(videoElement);
  }

  async changeAudioSource(forceStop = false): Promise<void> {
    // Force the stop of an existing track
    if (forceStop && this.audioTrack) {
      await this.client.liveKitRoom?.localParticipant.unpublishTrack(
        this.audioTrack,
      );
      this.audioTrack.stop();
      this.audioTrack = null;
      this.cleanupMixer();
      game.user?.broadcastActivity({ av: { muted: true } });
    }

    if (
      !this.audioTrack ||
      this.client.settings.get("client", "audioSrc") === "disabled" ||
      !this.client.avMaster.canUserBroadcastAudio(game.user?.id ?? "")
    ) {
      if (this.audioTrack) {
        await this.client.liveKitRoom?.localParticipant.unpublishTrack(
          this.audioTrack,
        );
        this.audioTrack.stop();
        this.audioTrack = null;
        this.cleanupMixer();
        game.user?.broadcastActivity({ av: { muted: true } });
      } else {
        await this.initializeAudioTrack();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.audioTrack) {
          await this.client.liveKitRoom?.localParticipant.publishTrack(
            this.audioTrack,
            this.trackPublishOptions,
          );
          game.user?.broadcastActivity({ av: { muted: false } });
          this.client.avMaster.render();
        }
      }
    } else {
      const secondaryAudioSrc = game.settings?.get(
        MODULE_NAME,
        "secondaryAudioSrc",
      );
      if (
        this.mixedMediaStream ||
        (secondaryAudioSrc && secondaryAudioSrc !== "disabled")
      ) {
        // If we are currently using a mixed track, or switching to one, we cannot simply restart
        // the track. Instead, perform a full re-initialization.
        await this.changeAudioSource(true);
        return;
      }

      const audioParams = this.getAudioParams(
        this.client.settings.get("client", "audioSrc") as string,
      );
      if (audioParams) {
        await this.audioTrack.restartTrack(audioParams);
      }
    }
  }

  async changeVideoSource(): Promise<void> {
    if (
      !this.videoTrack ||
      this.client.settings.get("client", "videoSrc") === "disabled" ||
      !this.client.avMaster.canUserBroadcastVideo(game.user?.id ?? "")
    ) {
      if (this.videoTrack) {
        await this.client.liveKitRoom?.localParticipant.unpublishTrack(
          this.videoTrack,
        );
        this.videoTrack.detach();
        this.videoTrack.stop();
        this.videoTrack = null;
        game.user?.broadcastActivity({ av: { hidden: true } });
      } else {
        await this.initializeVideoTrack();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.videoTrack) {
          await this.client.liveKitRoom?.localParticipant.publishTrack(
            this.videoTrack,
            this.trackPublishOptions,
          );
          const userVideoElement = document.querySelector(
            `.camera-view[data-user="${game.user?.id ?? ""}"] video.user-video`,
          );
          if (userVideoElement instanceof HTMLVideoElement) {
            this.attachVideoTrack(this.videoTrack, userVideoElement);
          }
          game.user?.broadcastActivity({ av: { hidden: false } });
          this.client.avMaster.render();
        }
      }
    } else {
      const videoParams = this.getVideoParams();
      if (videoParams) {
        await this.videoTrack.restartTrack(videoParams);
      }
    }
  }

  getAudioParams(
    audioSrc: string,
    isSecondary = false,
  ): AudioCaptureOptions | false {
    // Determine whether the user can send audio
    const canBroadcastAudio = this.client.avMaster.canUserBroadcastAudio(
      game.user?.id ?? "",
    );

    if (
      typeof audioSrc !== "string" ||
      audioSrc === "disabled" ||
      !canBroadcastAudio
    ) {
      return false;
    }

    const audioCaptureOptions: AudioCaptureOptions = {
      deviceId: audioSrc,
      channelCount: 2,
      voiceIsolation: true,
    };

    // Apply advanced audio input options if enabled
    if (game.settings?.get(MODULE_NAME, "advancedSettingsMode")) {
      const targetSource = game.settings.get(
        MODULE_NAME,
        "advancedSettingsTargetSource",
      );

      if (
        targetSource === "both" ||
        (targetSource === "secondary" && isSecondary) ||
        (targetSource === "primary" && !isSecondary)
      ) {
        this.applyAdvancedAudioOptions(audioCaptureOptions);
      }
    }

    return audioCaptureOptions;
  }

  /**
   * Clean up the audio mixer resources (secondary track, AudioContext, mixed stream).
   */
  cleanupMixer(): void {
    if (this.primaryAudioTrack) {
      this.primaryAudioTrack.stop();
      this.primaryAudioTrack = null;
    }
    if (this.secondaryAudioTrack) {
      this.secondaryAudioTrack.stop();
      this.secondaryAudioTrack = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch((error: unknown) => {
        log.error("Error closing AudioContext:", error);
      });
      this.audioContext = null;
    }
    this.mixedMediaStream = null;
    this.primaryGainNode = null;
    this.secondaryGainNode = null;
  }

  getUserAudioTrack(
    userId: string | undefined,
  ): LocalAudioTrack | RemoteAudioTrack | null {
    let audioTrack: LocalAudioTrack | RemoteAudioTrack | null = null;

    // If the user ID is null, return a null track
    if (!userId) {
      return audioTrack;
    }

    this.client.liveKitParticipants
      .get(userId)
      ?.audioTrackPublications.forEach((publication) => {
        if (
          publication.kind === Track.Kind.Audio &&
          (publication.track instanceof LocalAudioTrack ||
            publication.track instanceof RemoteAudioTrack)
        ) {
          audioTrack = publication.track;
        }
      });
    return audioTrack;
  }

  getUserVideoTrack(
    userId: string | undefined,
  ): LocalVideoTrack | RemoteVideoTrack | null {
    let videoTrack: LocalVideoTrack | RemoteVideoTrack | null = null;

    // If the user ID is null, return a null track
    if (!userId) {
      return videoTrack;
    }

    this.client.liveKitParticipants
      .get(userId)
      ?.videoTrackPublications.forEach((publication) => {
        if (
          publication.kind === Track.Kind.Video &&
          (publication.track instanceof LocalVideoTrack ||
            publication.track instanceof RemoteVideoTrack)
        ) {
          videoTrack = publication.track;
        }
      });
    return videoTrack;
  }

  async initializeLocalTracks(): Promise<void> {
    await this.initializeAudioTrack();
    await this.initializeVideoTrack();
  }

  /**
   * Create a mixed audio track from primary and secondary microphone inputs
   */
  async createMixedAudioTrack(
    primaryTrack: LocalAudioTrack,
  ): Promise<LocalAudioTrack | null> {
    const secondaryAudioSrc = game.settings?.get(
      MODULE_NAME,
      "secondaryAudioSrc",
    );

    const audioParams = this.getAudioParams(
      secondaryAudioSrc ?? "disabled",
      true,
    );

    if (!audioParams) {
      return null;
    }

    try {
      // Create the secondary audio track
      this.secondaryAudioTrack = await createLocalAudioTrack(audioParams);
    } catch (error: unknown) {
      let message = error;
      if (error instanceof Error) {
        message = error.message;
      }
      log.error("Unable to acquire secondary audio:", message);
      return null;
    }

    // Get the raw MediaStreamTracks from both LiveKit tracks
    const primaryMediaTrack = primaryTrack.mediaStreamTrack;
    const secondaryMediaTrack = this.secondaryAudioTrack.mediaStreamTrack;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!primaryMediaTrack || !secondaryMediaTrack) {
      log.error("Could not get MediaStreamTracks for mixing");
      this.secondaryAudioTrack.stop();
      this.secondaryAudioTrack = null;
      return null;
    }

    try {
      // Create the AudioContext at 48kHz for high-quality mixing
      this.audioContext = new AudioContext({ sampleRate: 48000 });

      const primarySource = this.audioContext.createMediaStreamSource(
        new MediaStream([primaryMediaTrack]),
      );
      const secondarySource = this.audioContext.createMediaStreamSource(
        new MediaStream([secondaryMediaTrack]),
      );

      // Create gain nodes for independent volume control of each source
      // Read initial values from settings (0-200 percent, converted to 0.0-2.0)
      const primaryGainPercent =
        game.settings?.get(MODULE_NAME, "primaryAudioGain") ?? 100;
      const secondaryGainPercent =
        game.settings?.get(MODULE_NAME, "secondaryAudioGain") ?? 100;

      this.primaryGainNode = this.audioContext.createGain();
      this.primaryGainNode.gain.value = primaryGainPercent / 100;
      this.secondaryGainNode = this.audioContext.createGain();
      this.secondaryGainNode.gain.value = secondaryGainPercent / 100;

      log.debug(
        "Created mixed audio track with gain settings - primary:",
        primaryGainPercent,
        "%, secondary:",
        secondaryGainPercent,
        "%",
      );

      const destination = this.audioContext.createMediaStreamDestination();
      destination.channelCount = 2;
      destination.channelCountMode = "explicit";

      primarySource.connect(this.primaryGainNode).connect(destination);
      secondarySource.connect(this.secondaryGainNode).connect(destination);

      this.mixedMediaStream = destination.stream;

      // Create a new LocalAudioTrack from the mixed stream
      const mixedMediaTrack = this.mixedMediaStream.getAudioTracks()[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mixedMediaTrack) {
        log.error("Mixed MediaStream has no audio tracks");
        this.cleanupMixer();
        return null;
      }

      const mixedTrack = new LocalAudioTrack(mixedMediaTrack);

      log.debug("Created mixed audio track from two microphone inputs");
      return mixedTrack;
    } catch (error: unknown) {
      let message = error;
      if (error instanceof Error) {
        message = error.message;
      }
      log.error("Error creating mixed audio track:", message);
      this.cleanupMixer();
      return null;
    }
  }

  async initializeAudioTrack(): Promise<void> {
    // Make sure the track is initially unset
    this.audioTrack = null;
    this.cleanupMixer();

    // Get audio parameters
    const audioParams = this.getAudioParams(
      this.client.settings.get("client", "audioSrc") as string,
    );

    // Get the track if requested
    if (audioParams) {
      try {
        this.audioTrack = await createLocalAudioTrack(audioParams);
      } catch (error: unknown) {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error("Unable to acquire local audio:", message);
      }
    }

    // Attempt to create a mixed track with the secondary microphone
    if (this.audioTrack) {
      try {
        const mixedTrack = await this.createMixedAudioTrack(this.audioTrack);
        if (mixedTrack) {
          this.primaryAudioTrack = this.audioTrack;
          this.audioTrack = mixedTrack;
        }
      } catch (error: unknown) {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error("Unable to create mixed track:", message);
      }
    }

    // Check that mute/hidden/broadcast is toggled properly for the track
    if (
      this.audioTrack &&
      !(
        this.client.liveKitAvClient.isVoiceAlways &&
        this.client.avMaster.canUserShareAudio(game.user?.id ?? "")
      )
    ) {
      await this.audioTrack.mute();
    }
  }

  async initializeVideoTrack(): Promise<void> {
    // Make sure the track is initially unset
    this.videoTrack = null;

    // Get video parameters
    const videoParams = this.getVideoParams();

    // Get the track if requested
    if (videoParams) {
      try {
        this.videoTrack = await createLocalVideoTrack(videoParams);
      } catch (error: unknown) {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error("Unable to acquire local video:", message);
      }
    }

    // Check that mute/hidden/broadcast is toggled properly for the track
    if (
      this.videoTrack &&
      !this.client.avMaster.canUserShareVideo(game.user?.id ?? "")
    ) {
      await this.videoTrack.mute();
    }
  }

  onTrackMuteChanged(
    publication: TrackPublication,
    participant: Participant,
  ): void {
    log.debug("onTrackMuteChanged:", publication, participant);

    // Local participant
    if (participant === this.client.liveKitRoom?.localParticipant) {
      log.debug("Local", publication.kind, "track muted:", publication.isMuted);
      return;
    }

    // Remote participant
    const fvttUserId = this.client.getParticipantFVTTUser(participant)?.id;
    const useExternalAV = this.client.getParticipantUseExternalAV(participant);

    if (!fvttUserId) {
      log.warn("Mute change participant", participant, "is not an FVTT user");
      return;
    }

    if (useExternalAV) {
      if (publication.kind === Track.Kind.Audio) {
        this.client.avMaster.settings.handleUserActivity(fvttUserId, {
          muted: publication.isMuted,
        });
      } else if (publication.kind === Track.Kind.Video) {
        this.client.avMaster.settings.handleUserActivity(fvttUserId, {
          hidden: publication.isMuted,
        });
      }
    } else {
      const userCameraView = document.querySelector(
        `.camera-view[data-user="${fvttUserId}"]`,
      );
      if (userCameraView) {
        let uiIndicator;
        if (publication.kind === Track.Kind.Audio) {
          uiIndicator = userCameraView.querySelector(".status-remote-muted");
        } else if (publication.kind === Track.Kind.Video) {
          uiIndicator = userCameraView.querySelector(".status-remote-hidden");
        }

        if (uiIndicator) {
          uiIndicator.classList.toggle("hidden", !publication.isMuted);
        }
      }
    }
  }

  onTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    log.debug("onTrackSubscribed:", track, publication, participant);
    const fvttUserId = this.client.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Track subscribed participant",
        participant,
        "is not an FVTT user",
      );
      return;
    }

    const videoElement = document.querySelector(
      `.camera-view[data-user="${fvttUserId}"]`,
    );

    if (!(videoElement instanceof HTMLVideoElement)) {
      log.debug(
        "videoElement not yet ready for",
        fvttUserId,
        "; skipping publication",
        publication,
      );
      debounceRefreshView(fvttUserId);
      return;
    }

    if (track instanceof RemoteAudioTrack) {
      // Get the audio element for the user
      const audioElement = this.client.uiManager.getUserAudioElement(
        fvttUserId,
        videoElement,
        publication.source,
      );
      if (audioElement) {
        this.attachAudioTrack(fvttUserId, track, audioElement).catch(
          (error: unknown) => {
            log.error("Error attaching audio track:", error);
          },
        );
      }
    } else if (track instanceof RemoteVideoTrack) {
      this.attachVideoTrack(track, videoElement);
    } else {
      log.warn("Unknown track type subscribed from publication", publication);
    }

    debounceRefreshView(fvttUserId);
  }

  onTrackUnSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    log.debug("onTrackUnSubscribed:", track, publication, participant);
    track.detach();
  }

  getVideoParams(): VideoCaptureOptions | false {
    // Configure whether the user can send video
    const videoSrc = this.client.settings.get("client", "videoSrc");
    const canBroadcastVideo = this.client.avMaster.canUserBroadcastVideo(
      game.user?.id ?? "",
    );

    const videoResolution = VideoPresets43.h1080.resolution;

    return typeof videoSrc === "string" &&
      videoSrc !== "disabled" &&
      canBroadcastVideo
      ? {
          deviceId: videoSrc,
          resolution: videoResolution,
        }
      : false;
  }

  setAudioEnabledState(enable: boolean): void {
    if (!this.audioTrack) {
      log.debug("setAudioEnabledState called but no audio track available");
      return;
    }
    if (this.client.liveKitRoom?.state !== ConnectionState.Connected) {
      log.debug(
        "setAudioEnabledState called but LiveKit room is not connected",
      );
      return;
    }

    if (!enable && !this.audioTrack.isMuted) {
      log.debug("Muting audio track", this.audioTrack);
      this.audioTrack.mute().catch((error: unknown) => {
        log.error("Error muting audio track:", error);
      });
    } else if (enable && this.audioTrack.isMuted) {
      log.debug("Un-muting audio track", this.audioTrack);
      this.audioTrack.unmute().catch((error: unknown) => {
        log.error("Error un-muting audio track:", error);
      });
    } else {
      log.debug(
        "setAudioEnabledState called but track is already in the current state",
      );
    }
  }

  async shareScreen(enabled: boolean): Promise<void> {
    log.info("shareScreen:", enabled);

    if (enabled) {
      // Configure audio options
      const screenAudioOptions: AudioCaptureOptions = {
        channelCount: 2,
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        voiceIsolation: false,
      };

      // Get screen tracks
      this.screenTracks = await createLocalScreenTracks({
        audio: screenAudioOptions,
      });

      for (const screenTrack of this.screenTracks) {
        log.debug("screenTrack enable:", screenTrack);
        if (screenTrack instanceof LocalVideoTrack) {
          // Stop our local video track
          if (this.videoTrack) {
            await this.client.liveKitRoom?.localParticipant.unpublishTrack(
              this.videoTrack,
            );
          }

          // Attach the screen share video to our video element
          const userVideoElement = document.querySelector(
            `.camera-view[data-user="${game.user?.id ?? ""}"]`,
          );
          if (userVideoElement instanceof HTMLVideoElement) {
            this.attachVideoTrack(screenTrack, userVideoElement);
          }
        }

        await this.client.liveKitRoom?.localParticipant.publishTrack(
          screenTrack,
          this.client.trackManager.trackPublishOptions,
        );
      }
    } else {
      for (const screenTrack of this.screenTracks) {
        log.debug("screenTrack disable:", screenTrack);
        // Unpublish the screen share track
        await this.client.liveKitRoom?.localParticipant.unpublishTrack(
          screenTrack,
        );

        // Restart our video track
        if (screenTrack instanceof LocalVideoTrack && this.videoTrack) {
          await this.client.liveKitRoom?.localParticipant.publishTrack(
            this.videoTrack,
            this.client.trackManager.trackPublishOptions,
          );

          if (!this.videoTrack.isMuted) {
            await this.videoTrack.unmute();
          }
        }
      }
    }
  }

  get trackPublishOptions(): TrackPublishOptions {
    const trackPublishOptions: TrackPublishOptions = {
      audioPreset: AudioPresets.musicHighQualityStereo,
      forceStereo: true,
      simulcast: true,
      videoCodec: "vp9",
      backupCodec: { codec: "vp8" },
      videoSimulcastLayers: [VideoPresets43.h720, VideoPresets43.h1440],
    };

    // Apply advanced track publish options if enabled
    if (game.settings?.get(MODULE_NAME, "advancedSettingsMode")) {
      this.applyAdvancedTrackOptions(trackPublishOptions);
    }

    return trackPublishOptions;
  }

  applyAdvancedTrackOptions(trackPublishOptions: TrackPublishOptions): void {
    trackPublishOptions.audioPreset = {
      maxBitrate:
        (game.settings?.get(MODULE_NAME, "audioBitRate") ?? 128) * 1000,
    };
    trackPublishOptions.dtx = game.settings?.get(MODULE_NAME, "dtx");
    trackPublishOptions.red = game.settings?.get(MODULE_NAME, "red");
    trackPublishOptions.videoCodec = game.settings?.get(
      MODULE_NAME,
      "videoCodec",
    ) as "vp9";
    trackPublishOptions.backupCodec = {
      codec: game.settings?.get(MODULE_NAME, "backupCodec") as "vp8",
    };
  }

  applyAdvancedAudioOptions(audioCaptureOptions: AudioCaptureOptions): void {
    audioCaptureOptions.autoGainControl = game.settings?.get(
      MODULE_NAME,
      "autoGainControl",
    );
    audioCaptureOptions.echoCancellation = game.settings?.get(
      MODULE_NAME,
      "echoCancellation",
    );
    audioCaptureOptions.noiseSuppression = game.settings?.get(
      MODULE_NAME,
      "noiseSuppression",
    );
    audioCaptureOptions.voiceIsolation = game.settings?.get(
      MODULE_NAME,
      "voiceIsolation",
    );
  }

  /**
   * Set the gain for the primary audio source in the mixed track.
   * @param percent - Gain as a percentage (0-200, where 100 = original volume)
   */
  setPrimaryGain(percent: number): void {
    if (!this.primaryGainNode) {
      log.debug("setPrimaryGain called but no primary gain node available");
      return;
    }
    const gainValue = percent / 100;
    log.debug("Setting primary audio gain to", percent, "% (", gainValue, ")");
    this.primaryGainNode.gain.value = gainValue;
  }

  /**
   * Set the gain for the secondary audio source in the mixed track.
   * @param percent - Gain as a percentage (0-200, where 100 = original volume)
   */
  setSecondaryGain(percent: number): void {
    if (!this.secondaryGainNode) {
      log.debug("setSecondaryGain called but no secondary gain node available");
      return;
    }
    const gainValue = percent / 100;
    log.debug(
      "Setting secondary audio gain to",
      percent,
      "% (",
      gainValue,
      ")",
    );
    this.secondaryGainNode.gain.value = gainValue;
  }
}
