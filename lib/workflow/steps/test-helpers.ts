import { createDemoInsForgeClient } from "@/lib/adapters/insforge/demo-store";
import type { AdapterSet } from "@/lib/adapters/factory-core";
import type {
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
} from "@/lib/adapters/types";

import type { StepDeps } from "../context";

/**
 * Test-only adapter wiring for the workflow step cores.
 *
 * The create-scan / plan-targets cores only ever touch the InsForge adapter
 * (and only to read/scope), so this helper injects a real demo in-memory
 * {@link InsForgeClient} and trivial throwing stubs for the other three. Any
 * accidental use of Apify/Box/Model from these steps would therefore fail loudly
 * rather than pass silently. Adapters are INJECTED via {@link StepDeps}, exactly
 * as the assembly (task 18.8) and the API route (task 20.6) do at runtime — the
 * cores never construct an adapter themselves (Requirement 23.1).
 */

/** A stub whose every method throws — proves a core never calls this adapter. */
function unusedAdapter<T>(name: string): T {
  return new Proxy(
    { isConfigured: () => false, mode: "demo" as const },
    {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        return () => {
          throw new Error(`${name} adapter must not be used by this step`);
        };
      },
    },
  ) as T;
}

/** Build an {@link AdapterSet} with the given InsForge client + stub others. */
export function makeAdapterSet(insforge: InsForgeClient): AdapterSet {
  return {
    apify: unusedAdapter<ApifyClient>("apify"),
    box: unusedAdapter<BoxClient>("box"),
    insforge,
    model: unusedAdapter<ModelClient>("model"),
  };
}

/** Build {@link StepDeps} backed by a fresh demo InsForge store (no seed). */
export function makeStepDeps(insforge?: InsForgeClient): {
  deps: StepDeps;
  insforge: InsForgeClient;
} {
  const client = insforge ?? createDemoInsForgeClient({ seedDemoCompany: false });
  return { deps: { adapters: makeAdapterSet(client) }, insforge: client };
}
