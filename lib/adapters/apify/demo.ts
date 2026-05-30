import "server-only";

import type { SnapshotState } from "@/lib/demo";
import type {
  ApifyClient,
  CaptureRequest,
  CaptureResult,
  RunMode,
} from "@/lib/adapters/types";

import { captureDemoRequests, DEFAULT_CAPTURE_STATE } from "./demo-capture";

/**
 * Demo implementation of {@link ApifyClient}.
 *
 * Used whenever the Apify adapter resolves to `"demo"` — `DEMO_MODE` is on, or
 * the Apify credential is missing (Requirement 18.1, 18.2). It returns seeded
 * snapshot HTML for the Demo_Company sources with `simulated = true` and
 * **never** makes a network call (Requirements 8.6, 18.1, 19.1).
 *
 * Output is fully deterministic: the same requests always yield the same
 * results, so Demo_Mode is reproducible across repeated scans (Requirement
 * 18.7). All capture logic lives in the pure `./demo-capture` module; this
 * class only carries the adapter contract (`mode`, `isConfigured`).
 */
export class DemoApifyClient implements ApifyClient {
  readonly mode: RunMode = "demo";

  /**
   * @param state Which seeded snapshot state to capture. Defaults to
   *   `"current"` so a demo scan diffs against a prior `"previous"` snapshot
   *   and reveals the upmarket shift.
   */
  constructor(private readonly state: SnapshotState = DEFAULT_CAPTURE_STATE) {}

  /** The demo client never holds live credentials. */
  isConfigured(): boolean {
    return false;
  }

  /**
   * Return exactly one seeded {@link CaptureResult} per request. Resolves
   * synchronously-equivalent deterministic data; never throws and never reaches
   * the network (Requirements 8.6, 18.1, 19.1).
   */
  async capture(requests: CaptureRequest[]): Promise<CaptureResult[]> {
    return captureDemoRequests(requests, this.state);
  }
}
