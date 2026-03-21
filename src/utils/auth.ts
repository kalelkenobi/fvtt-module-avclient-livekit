import { SignJWT } from "jose";
import { Logger } from "./logger";

const log = new Logger();

/**
 * Creates a new AccessToken and returns it as a signed JWT
 * @param apiKey API Key
 * @param apiSecret Secret
 * @param roomName The LiveKit room to join
 * @param userName Display name of the FVTT user
 * @param metadata User metadata, including the FVTT User ID
 */
export async function getAccessToken(
  apiKey: string | undefined,
  secretKey: string | undefined,
  roomName: string,
  userName: string,
  metadata: string,
): Promise<string> {
  // Set the payload to be signed, including the permission to join the room and the user metadata
  const tokenPayload = {
    video: {
      // LiveKit permission grants
      roomJoin: true,
      room: roomName,
    },
    metadata: metadata,
  };

  // Get the epoch timestamp for 15m before now for JWT not before value
  const notBefore = Math.floor(
    new Date(Date.now() - 1000 * (60 * 15)).getTime() / 1000,
  );

  // If the API Key or Secret is not set, log an error and return an empty string
  if (!apiKey || !secretKey) {
    log.error(
      "API Key or Secret is not set. Please configure the LiveKit API Key and Secret",
    );
    return "";
  }

  // Sign and return the JWT
  const accessTokenJwt = await new SignJWT(tokenPayload)
    .setIssuer(apiKey) // The configured API Key
    .setExpirationTime("10h") // Expire after 12 hours
    .setJti(userName) // Use the username for the JWT ID
    .setSubject(userName) // Use the username for the JWT Subject
    .setNotBefore(notBefore) // Give us a 15 minute buffer in case the user's clock is set incorrectly
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secretKey));

  log.debug("AccessToken:", accessTokenJwt);
  return accessTokenJwt;
}