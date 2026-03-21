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