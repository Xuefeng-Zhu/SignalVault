import { describe, expect, it, vi } from "vitest";

import type { AdapterRunModes } from "@/lib/config/env";
import type {
  Adapter,
  ApifyClient,
  BoxClient,
  InsForgeClient,
  ModelClient,
  RunMode,
} from "./types";

import {
  selectAdapters,
  selectImpl,
  type AdapterImplPair,
  type AdapterImplPairs,
} from "./factory-core";

/**
 * Unit tests for the pure demo/live selection core (task 6.2, Requirements
 * 18.1, 18.2, 23.1). These exercise the selection logic the server-only
 * `./factory` wires the concrete adapters into — no `server-only` modules, no
 * environment reads, no network.
 */

/** A minimal {@link Adapter} fake tagged with the mode it represents. */
function fakeAdapter(mode: RunMode): Adapter {
  return { mode, isConfigured: () => mode === "live" };
}

/**
 * Build a `live`/`demo` constructor pair whose factories return tagged fakes
 * and record how many times each was invoked, so tests can assert that only the
 * selected implementation is constructed (laziness).
 */
function trackedPair(): {
  pair: AdapterImplPair<Adapter>;
  liveCalls: () => number;
  demoCalls: () => number;
} {
  const live = vi.fn(() => fakeAdapter("live"));
  const demo = vi.fn(() => fakeAdapter("demo"));
  return {
    pair: { live, demo },
    liveCalls: () => live.mock.calls.length,
    demoCalls: () => demo.mock.calls.length,
  };
}

describe("selectImpl", () => {
  it("constructs the live implementation when the mode is 'live'", () => {
    const { pair, liveCalls, demoCalls } = trackedPair();

    const impl = selectImpl("live", pair);

    expect(impl.mode).toBe("live");
    expect(liveCalls()).toBe(1);
    // Laziness: the unselected demo constructor is never invoked.
    expect(demoCalls()).toBe(0);
  });

  it("constructs the demo implementation when the mode is 'demo'", () => {
    const { pair, liveCalls, demoCalls } = trackedPair();

    const impl = selectImpl("demo", pair);

    expect(impl.mode).toBe("demo");
    expect(demoCalls()).toBe(1);
    expect(liveCalls()).toBe(0);
  });
});

/** Tag every adapter pair with its kind so the result is identifiable. */
function taggedPairs(): AdapterImplPairs {
  const pair = <T extends Adapter>(): AdapterImplPair<T> => ({
    live: () => fakeAdapter("live") as T,
    demo: () => fakeAdapter("demo") as T,
  });
  return {
    apify: pair<ApifyClient>(),
    box: pair<BoxClient>(),
    insforge: pair<InsForgeClient>(),
    model: pair<ModelClient>(),
  };
}

describe("selectAdapters", () => {
  it("selects every adapter live when all modes are 'live'", () => {
    const modes: AdapterRunModes = {
      apify: "live",
      box: "live",
      insforge: "live",
      model: "live",
    };

    const set = selectAdapters(taggedPairs(), modes);

    expect(set.apify.mode).toBe("live");
    expect(set.box.mode).toBe("live");
    expect(set.insforge.mode).toBe("live");
    expect(set.model.mode).toBe("live");
  });

  it("selects every adapter demo when all modes are 'demo' (DEMO_MODE)", () => {
    const modes: AdapterRunModes = {
      apify: "demo",
      box: "demo",
      insforge: "demo",
      model: "demo",
    };

    const set = selectAdapters(taggedPairs(), modes);

    expect(set.apify.mode).toBe("demo");
    expect(set.box.mode).toBe("demo");
    expect(set.insforge.mode).toBe("demo");
    expect(set.model.mode).toBe("demo");
  });

  it("supports mixed modes within one run (live InsForge + demo Apify)", () => {
    // Requirement 18.2: each adapter falls back independently, so a single run
    // can be live for one adapter and demo for another.
    const modes: AdapterRunModes = {
      apify: "demo",
      box: "demo",
      insforge: "live",
      model: "live",
    };

    const set = selectAdapters(taggedPairs(), modes);

    expect(set.apify.mode).toBe("demo");
    expect(set.box.mode).toBe("demo");
    expect(set.insforge.mode).toBe("live");
    expect(set.model.mode).toBe("live");
  });

  it("maps each adapter's mode independently to its own implementation", () => {
    // Each of the four adapters honors its own slot in AdapterRunModes.
    const modes: AdapterRunModes = {
      apify: "live",
      box: "demo",
      insforge: "demo",
      model: "live",
    };

    const set = selectAdapters(taggedPairs(), modes);

    expect(set.apify.mode).toBe("live");
    expect(set.box.mode).toBe("demo");
    expect(set.insforge.mode).toBe("demo");
    expect(set.model.mode).toBe("live");
  });
});
