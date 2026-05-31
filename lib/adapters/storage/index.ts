/**
 * Barrel for the InsForge storage adapter implementations.
 *
 * Exposes the live {@link import('@/lib/adapters/types').BoxClient} backed by
 * InsForge storage (replacing the former Box REST client) and re-exports the
 * routing logic shared between adapters.
 */
export { createLiveStorageClient } from "./live";
export {
  InsForgeStorageClient,
  type InsForgeStorageClientOptions,
} from "./live-storage";
