import LiveKitAVClient from "../src/LiveKitAVClient";
/**
 * Interfaces
 */

// LiveKit connection settings
interface LiveKitConnectionSettings {
  url?: string;
  room?: string;
  username?: string;
  password?: string;
}

// Recorder connection settings
interface RecorderConnectionSettings {
  url?: string;
  apiToken?: string;
}

// Custom foundry socket message
interface SocketMessage {
  action: "breakout" | "connect" | "disconnect" | "render";
  userId?: string;
  breakoutRoom?: string;
}

/**
 * Types
 */

type LiveKitSettingsConfig = SettingConfig & {
  id?: string;
  value?: unknown;
  settingType?: string;
  isCheckbox?: boolean;
  isSelect?: boolean;
  isRange?: boolean;
  isNumber?: boolean;
  filePickerType?: string;
};

type BreakoutRoomRegistry = Record<string, string | undefined>;

// Recorder state machine
type RecorderState = "idle" | "recording" | "stopping";

// Recorder service status response
interface RecorderRoomStatus {
  room: string;
  session_id: string;
  is_active: boolean;
  participants?: Record<
    string,
    { is_receiving: boolean; samples_written: number }
  >;
}

// Recorder service start/stop response
interface RecorderActionResponse {
  status: string;
  room: string;
  session_id: string;
  message?: string;
}

// Recorder WebSocket event payload
interface RecorderWsEvent {
  event: "recording_started" | "recording_stopped" | "mix_started" | "mix_progress" | "mix_complete" | "mix_failed";
  session_id: string;
  room: string;
  reason?: string;
  format?: string;
  progress_pct?: number;
  started_at?: string;
  completed_at?: string;
  size_bytes?: number;
  error?: string;
  failed_at?: string;
}

/**
 * Global settings
 */

// Set game.webrtc.client to LiveKitAVClient
declare global {
  interface WebRTCConfig {
    clientClass: typeof LiveKitAVClient;
  }

  // Add settings for the module
  interface SettingConfig {
    "avclient-livekit.liveKitConnectionSettings": LiveKitConnectionSettings;
    "avclient-livekit.breakoutRoomRegistry": BreakoutRoomRegistry;
    "avclient-livekit.secondaryAudioSrc": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: "disabled";
    }>;
    "avclient-livekit.advancedSettingsTargetSource": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: "both";
    }>;
    "avclient-livekit.autoConnect": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.displayConnectionQuality": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.advancedSettingsMode": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.autoGainControl": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.echoCancellation": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.noiseSuppression": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.voiceIsolation": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.audioBitRate": foundry.data.fields.NumberField<{
      initial: 128;
      min: 8;
      max: 510;
      step: 8;
      integer: true;
    }>;
    "avclient-livekit.dtx": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.red": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.videoCodec": foundry.data.fields.StringField<{
      initial: "vp9";
    }>;
    "avclient-livekit.backupCodec": foundry.data.fields.StringField<{
      initial: "vp8";
    }>;
    "avclient-livekit.useExternalAV": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.resetRoom": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.debug": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.devMode": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.liveKitTrace": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.forceTurn": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.primaryAudioGain": foundry.data.fields.NumberField<{
      initial: 100;
      min: 0;
      max: 200;
      step: 5;
      integer: true;
    }>;
    "avclient-livekit.secondaryAudioGain": foundry.data.fields.NumberField<{
      initial: 100;
      min: 0;
      max: 200;
      step: 5;
      integer: true;
    }>;
    "avclient-livekit.recorderConnectionSettings": RecorderConnectionSettings;
  }
}
