/**
 * Barrel for the Integration credential-storage layer (task 20.9).
 *
 * - `./schemas` — Zod request-body schemas + canonical config serialization
 *   (no `server-only`; reusable by tests).
 * - `./store` — server-only encrypt/mock decision + browser response shaping
 *   (the importable unit the credential-non-leakage property test targets,
 *   task 20.11).
 * - `./handler` — the shared route-handler implementation both provider
 *   endpoints delegate to.
 */
export {
  ApifyConfigSchema,
  BoxConfigSchema,
  configSchemaFor,
  serializeConfig,
  type ApifyConfig,
  type BoxConfig,
  type IntegrationConfig,
} from "./schemas";

export {
  buildStoredCredential,
  buildIntegrationRow,
  buildIntegrationResponse,
  MissingEncryptionSecretError,
  CREDENTIAL_MASK,
  type StoredCredential,
  type BuildStoredCredentialInput,
  type IntegrationResponse,
} from "./store";

export { handleStoreIntegration } from "./handler";
