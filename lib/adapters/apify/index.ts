/**
 * Barrel for the Apify adapter implementations.
 *
 * Exposes the live {@link ApifyClient} (task 9.1). The server-only `./live`
 * entry binds the real Apify token; the `./live-capture` core (also re-exported)
 * carries the testable capture logic.
 */
export { createLiveApifyClient } from "./live";
export {
  LiveApifyClient,
  APIFY_CAPTURE_ACTOR_ID,
  MAX_CAPTURE_TIMEOUT_MS,
  type LiveApifyClientOptions,
} from "./live-capture";
