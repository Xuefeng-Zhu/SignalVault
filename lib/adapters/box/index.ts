/**
 * Barrel for the Box adapter implementations.
 *
 * Exposes the live {@link import('@/lib/adapters/types').BoxClient} (task 11.1)
 * and the demo client (task 11.2). The server-only `./live` entry binds the
 * real Box credentials; the `./live-box` core (also re-exported) carries the
 * testable folder-tree creation, type→subfolder routing, and upload logic. The
 * selection factory (task 6.2) is added by its own task.
 */
export { createLiveBoxClient } from "./live";
export {
  LiveBoxClient,
  createLiveBoxClientCore,
  BOX_WEB_BASE,
  type LiveBoxClientOptions,
} from "./live-box";
export {
  SUBFOLDER_KEYS,
  SUBFOLDER_BOX_NAMES,
  subfolderKeyForArtifact,
  type SubfolderKey,
} from "./routing";
export { DemoBoxClient, createDemoBoxClient } from "./demo";
