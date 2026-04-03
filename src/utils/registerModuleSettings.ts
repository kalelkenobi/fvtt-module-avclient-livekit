import { MODULE_NAME } from "./constants";
import { Logger } from "./logger";
import debug from "debug";

const log = new Logger();

export default function registerModuleSettings(): void {
  game.settings?.register(MODULE_NAME, "secondaryAudioSrc", {
    name: "LIVEKITAVCLIENT.secondaryAudioSrc",
    hint: "LIVEKITAVCLIENT.secondaryAudioSrcHint",
    scope: "client",
    config: true,
    default: "disabled",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "disabled",
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("secondaryAudioSrc: Error changing audio source", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "autoConnect", {
    name: "LIVEKITAVCLIENT.autoConnect",
    hint: "LIVEKITAVCLIENT.autoConnectHint",
    scope: "client",
    config: true,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
  });

  game.settings?.register(MODULE_NAME, "displayConnectionQuality", {
    name: "LIVEKITAVCLIENT.displayConnectionQuality",
    hint: "LIVEKITAVCLIENT.displayConnectionQualityHint",
    scope: "client",
    config: true,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => game.webrtc?.render(),
  });

  game.settings?.register(MODULE_NAME, "liveKitConnectionSettings", {
    name: "LIVEKITAVCLIENT.liveKitConnectionSettings",
    hint: "LIVEKITAVCLIENT.liveKitConnectionSettingsHint",
    scope: "world",
    config: false,
    default: {},
    requiresReload: true,
  });

  game.settings?.register(MODULE_NAME, "breakoutRoomRegistry", {
    name: "LIVEKITAVCLIENT.breakoutRoomRegistry",
    hint: "LIVEKITAVCLIENT.breakoutRoomRegistryHint",
    scope: "client",
    config: false,
    default: {},
    requiresReload: false,
  });

  game.settings?.register(MODULE_NAME, "useExternalAV", {
    name: "LIVEKITAVCLIENT.useExternalAV",
    hint: "LIVEKITAVCLIENT.useExternalAVHint",
    scope: "client",
    config: true,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  game.settings?.register(MODULE_NAME, "advancedSettingsMode", {
    name: "LIVEKITAVCLIENT.advancedSettingsMode",
    hint: "LIVEKITAVCLIENT.advancedSettingsModeHint",
    scope: "client",
    config: true,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  // Gain controls for mixed audio sources (visible only in advanced mode with secondary source enabled)
  const showGainControls =
    (game.settings?.get(MODULE_NAME, "advancedSettingsMode") ?? false) &&
    (game.settings?.get(MODULE_NAME, "secondaryAudioSrc") ?? "disabled") !==
      "disabled";

  game.settings?.register(MODULE_NAME, "primaryAudioGain", {
    name: "LIVEKITAVCLIENT.primaryAudioGain",
    hint: "LIVEKITAVCLIENT.primaryAudioGainHint",
    scope: "client",
    config: showGainControls,
    default: 100,
    type: new foundry.data.fields.NumberField({
      initial: 100,
      min: 0,
      max: 200,
      step: 5,
      integer: true,
    }),
    range: { min: 0, max: 200, step: 5 },
    onChange: () => {
      const value = game.settings.get(MODULE_NAME, "primaryAudioGain") ?? 100;
      game.webrtc?.client._liveKitClient.trackManager.setPrimaryGain(value);
    },
  });

  game.settings?.register(MODULE_NAME, "secondaryAudioGain", {
    name: "LIVEKITAVCLIENT.secondaryAudioGain",
    hint: "LIVEKITAVCLIENT.secondaryAudioGainHint",
    scope: "client",
    config: showGainControls,
    default: 100,
    type: new foundry.data.fields.NumberField({
      initial: 100,
      min: 0,
      max: 200,
      step: 5,
      integer: true,
    }),
    range: { min: 0, max: 200, step: 5 },
    onChange: () => {
      const value = game.settings.get(MODULE_NAME, "secondaryAudioGain") ?? 100;
      game.webrtc?.client._liveKitClient.trackManager.setSecondaryGain(value);
    },
  });

  game.settings?.register(MODULE_NAME, "advancedSettingsTargetSource", {
    name: "LIVEKITAVCLIENT.advancedSettingsTargetSource",
    hint: "LIVEKITAVCLIENT.advancedSettingsTargetSourceHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: "both",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "both",
      choices: {
        both: "both",
        primary: "primary",
        secondary: "secondary",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error(
            "advancedSettingsTargetSource: Error changing target capture source",
            error,
          );
        });
    },
  });

  // Advanced Mode: Audio Options
  game.settings?.register(MODULE_NAME, "autoGainControl", {
    name: "LIVEKITAVCLIENT.autoGainControl",
    hint: "LIVEKITAVCLIENT.autoGainControlHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("autoGainControl: Error changing audio option", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "echoCancellation", {
    name: "LIVEKITAVCLIENT.echoCancellation",
    hint: "LIVEKITAVCLIENT.echoCancellationHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("echoCancellation: Error changing audio option", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "noiseSuppression", {
    name: "LIVEKITAVCLIENT.noiseSuppression",
    hint: "LIVEKITAVCLIENT.noiseSuppressionHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("noiseSuppression: Error changing audio option", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "voiceIsolation", {
    name: "LIVEKITAVCLIENT.voiceIsolation",
    hint: "LIVEKITAVCLIENT.voiceIsolationHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("voiceIsolation: Error changing audio option", error);
        });
    },
  });

  //
  // Advanced Mode: Track Options
  //
  game.settings?.register(MODULE_NAME, "audioBitRate", {
    name: "LIVEKITAVCLIENT.audioBitRate",
    hint: "LIVEKITAVCLIENT.audioBitRateHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: 128,
    type: new foundry.data.fields.NumberField({
      initial: 128,
      min: 8,
      max: 510,
      step: 8,
      integer: true,
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("audioBitRate: Error changing track bitrate", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "dtx", {
    name: "LIVEKITAVCLIENT.dtx",
    hint: "LIVEKITAVCLIENT.dtxHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("dtx: Error changing DTX for track", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "red", {
    name: "LIVEKITAVCLIENT.red",
    hint: "LIVEKITAVCLIENT.redHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeAudioSource(true)
        .catch((error: unknown) => {
          log.error("red: Error changing RED for track", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "videoCodec", {
    name: "LIVEKITAVCLIENT.videoCodec",
    hint: "LIVEKITAVCLIENT.videoCodecHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: "vp9",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "vp9",
      choices: {
        vp8: "VP8",
        h264: "H.264",
        vp9: "VP9",
        av1: "AV1",
        h265: "H.265",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeVideoSource()
        .catch((error: unknown) => {
          log.error("videoCodec: Error changing video source", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "backupCodec", {
    name: "LIVEKITAVCLIENT.backupCodec",
    hint: "LIVEKITAVCLIENT.backupCodecHint",
    scope: "client",
    config: game.settings.get(MODULE_NAME, "advancedSettingsMode") ?? false,
    default: "vp8",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "vp8",
      choices: {
        vp8: "VP8",
        h264: "H.264",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.trackManager
        .changeVideoSource()
        .catch((error: unknown) => {
          log.error("backupCodec: Error changing video source", error);
        });
    },
  });

  game.settings?.register(MODULE_NAME, "resetRoom", {
    name: "LIVEKITAVCLIENT.resetRoom",
    hint: "LIVEKITAVCLIENT.resetRoomHint",
    scope: "world",
    config: true,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: (value: boolean | null) => {
      if (value && game.user?.isGM) {
        log.warn("Resetting meeting room ID");
        game.settings
          .set(MODULE_NAME, "resetRoom", false)
          .then(() => {
            const liveKitConnectionSettings = game.settings.get(
              MODULE_NAME,
              "liveKitConnectionSettings",
            );
            liveKitConnectionSettings.room = foundry.utils.randomID(32);
            game.settings
              .set(
                MODULE_NAME,
                "liveKitConnectionSettings",
                liveKitConnectionSettings,
              )
              .catch((error: unknown) => {
                log.error("Error setting liveKitConnectionSettings:", error);
              });
          })
          .catch((error: unknown) => {
            log.error("Error resetting meeting room ID", error);
          });
      }
    },
    requiresReload: true,
  });

  // Register debug logging setting
  game.settings?.register(MODULE_NAME, "debug", {
    name: "LIVEKITAVCLIENT.debug",
    hint: "LIVEKITAVCLIENT.debugHint",
    scope: "world",
    config: true,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  // Register debug trace logging setting
  game.settings?.register(MODULE_NAME, "liveKitTrace", {
    name: "LIVEKITAVCLIENT.liveKitTrace",
    hint: "LIVEKITAVCLIENT.liveKitTraceHint",
    scope: "world",
    config: game.settings.get(MODULE_NAME, "debug") ?? false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  // Register devMode setting
  game.settings?.register(MODULE_NAME, "devMode", {
    name: "LIVEKITAVCLIENT.devMode",
    hint: "LIVEKITAVCLIENT.devModeHint",
    scope: "world",
    config: import.meta.env.MODE === "development",
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  //
  // devMode Settings
  //

  // Register forced TURN setting
  game.settings?.register(MODULE_NAME, "forceTurn", {
    name: "LIVEKITAVCLIENT.forceTurn",
    hint: "LIVEKITAVCLIENT.forceTurnHint",
    scope: "world",
    config: game.settings.get(MODULE_NAME, "devMode") ?? false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  //
  // Set the initial debug level
  //
  if (game.settings?.get(MODULE_NAME, "debug")) {
    if (game.settings.get(MODULE_NAME, "liveKitTrace")) {
      debug.enable("*");
      log.info("Enabling trace logging");
    } else {
      debug.enable(
        `${MODULE_NAME}:DEBUG,${MODULE_NAME}:DEBUG:*,${MODULE_NAME}:INFO,${MODULE_NAME}:INFO:*,${MODULE_NAME}:WARN,${MODULE_NAME}:WARN:*,${MODULE_NAME}:ERROR,${MODULE_NAME}:ERROR:*`,
      );
      log.info("Enabling debug logging");
    }
    // Enable Foundry AV debug logging
    CONFIG.debug.av = true;
    CONFIG.debug.avclient = true;
  } else {
    debug.enable(
      `${MODULE_NAME}:INFO,${MODULE_NAME}:INFO:*,${MODULE_NAME}:WARN,${MODULE_NAME}:WARN:*,${MODULE_NAME}:ERROR,${MODULE_NAME}:ERROR:*`,
    );
    // Disable Foundry AV debug logging
    CONFIG.debug.av = false;
    CONFIG.debug.avclient = false;
  }
}
