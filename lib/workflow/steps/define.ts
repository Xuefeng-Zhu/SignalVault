import { createStep } from "@mastra/core/workflows";
import type { z } from "zod";

import type { ScanStatus, StepDeps } from "../context";
import { parseAtBoundary } from "./artifacts";

/**
 * Adapter between SignalVault's pure step cores and Mastra's `createStep`.
 *
 * The early steps (`createScanStep`, `planWatchTargetsStep`) are authored as
 * pure cores of the form `(input, deps) => Promise<output>`, where
 * `input`/`output` are the serializable, Zod-validated boundary states from
 * `../context` and `deps` carries the injected
 * {@link import('../context').WorkflowContext.adapters} (the sole door to
 * external services — Requirement 23.1). Authoring cores this way keeps them
 * importable and exercisable offline by the property tests (18.10) and the
 * integration test (18.11): a test injects fake adapters and calls the core
 * directly, with no Mastra runtime and no `server-only` module in the import
 * graph.
 *
 * {@link defineWorkflowStep} lifts such a core into a real Mastra `Step`,
 * binding the adapters from a closure captured by the assembly (task 18.8) /
 * the API route (task 20.6). It enforces the schema gate of Requirements
 * 23.5/23.6 explicitly using the shared {@link parseAtBoundary} helper: the
 * input is parsed before the core consumes it and the output is parsed before
 * it is handed to the next step, and a failure halts the step with a
 * {@link import('./artifacts').StepBoundaryError} naming the offending field.
 */

/**
 * A pure step core. Receives the parsed, Zod-validated `input` boundary state
 * and the injected adapters, and returns the next boundary state. It MUST NOT
 * read credentials or construct adapters itself — everything external arrives
 * through `deps.adapters`.
 */
export type StepCore<TInput, TOutput> = (
  input: TInput,
  deps: StepDeps,
) => Promise<TOutput>;

/** Declarative description of a workflow step, independent of Mastra wiring. */
export interface WorkflowStepConfig<TInput, TOutput> {
  /** Stable step id (matches the design's step name, e.g. `createScanStep`). */
  id: string;
  description?: string;
  /**
   * The {@link ScanStatus} this step maps to in the design's step table. Steps
   * that own a status transition persist it themselves (persist-before-emit,
   * Requirement 7.2); the value is also exposed for the assembly/timeline.
   */
  status: ScanStatus;
  /** Zod schema gating the step's input (Requirement 23.5). */
  inputSchema: z.ZodType<TInput>;
  /** Zod schema gating the step's output (Requirement 23.6). */
  outputSchema: z.ZodType<TOutput>;
  /** The pure core implementing the step's logic. */
  core: StepCore<TInput, TOutput>;
}

/**
 * Lift a {@link WorkflowStepConfig} + injected {@link StepDeps} into a Mastra
 * `Step`. The returned step validates its input, runs the core, and validates
 * the core's output — halting (throwing a `StepBoundaryError`) on any boundary
 * validation failure without letting invalid data through (Requirements 23.5,
 * 23.6).
 */
export function defineWorkflowStep<TInput, TOutput>(
  config: WorkflowStepConfig<TInput, TOutput>,
  deps: StepDeps,
) {
  return createStep({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: async ({ inputData }: { inputData: unknown }) => {
      const input = parseAtBoundary(config.inputSchema, inputData, `${config.id} input`);
      const output = await config.core(input, deps);
      return parseAtBoundary(config.outputSchema, output, `${config.id} output`);
    },
  });
}
