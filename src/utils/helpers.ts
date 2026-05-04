import { Logger } from "./logger";

const log = new Logger();

/**
 * Issue a delayed (debounced) reload to the whole window.
 * Allows settings to get saved before reload
 */
export const delayReload: () => void = foundry.utils.debounce(() => {
  window.location.reload();
}, 100);

export const debounceRefreshView: (userId: string) => void =
  foundry.utils.debounce((userId: string) => {
    ui.webrtc?.render({ parts: [userId] }).catch((error: unknown) => {
      log.error("Error refreshing user view:", error);
    });
  }, 200);

export function callWhenReady(fnToCall: () => unknown): void {
  if (game.ready) {
    log.debug("callWhenReady now", fnToCall);
    fnToCall();
  } else {
    log.debug("callWhenReady ready", fnToCall);
    Hooks.once("ready", fnToCall);
  }
}

/**
 * Build a stable, recorder-compatible LiveKit room name in the form
 * `[worldId]_[randomID(32)]`.
 *
 * The recorder service requires room names to start with an alphanumeric
 * character and only contain `[a-zA-Z0-9._-]` (max 200 chars). We sanitize
 * the world id to comply with this constraint. The resulting name is also
 * a valid LiveKit room name.
 */
export function buildRoomName(): string {
  const rawWorldId = game.world?.id ?? "world";
  // Strip characters disallowed by the recorder regex
  const sanitized =
    rawWorldId.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^[._-]+/, "") ||
    "world";
  return `${sanitized}_${foundry.utils.randomID(32)}`.slice(0, 200);
}

/**
 * Format a Date as `YYYY-MM-DD_HH-mm-ss` using local time. Suitable for use
 * as a recorder session id (matches the recorder service's
 * `[a-zA-Z0-9._-]` constraint).
 */
export function formatRecorderTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    "-",
    pad(date.getMinutes()),
    "-",
    pad(date.getSeconds()),
  ].join("");
}