import "server-only";

import { createClient } from "@insforge/sdk";

import {
  isModelConfigured,
  readModelProviderCredentials,
  type ModelProviderEndpoint,
} from "@/lib/config/env";
import type { InferenceRequest, ModelClient, RunMode } from "@/lib/adapters/types";

import { resolveModelProvider, type ModelProvider } from "./resolve";

/**
 * Live {@link ModelClient} — routes inference to an OpenAI-compatible
 * chat-completions endpoint (Requirement 24.1).
 *
 * Provider precedence (Requirement 24.2): when more than one provider is
 * configured, a FIXED precedence prefers the InsForge Model Gateway over a
 * direct MODEL_BASE_URL/MODEL_API_KEY provider. The decision itself is factored
 * into the pure, dependency-free {@link resolveModelProvider} (in `./resolve.ts`)
 * so it is unit/property-testable without any network access (task 13.3).
 *
 * Timeout (Requirement 24.4): each request is bounded by a 60s ceiling. On
 * timeout the request is abandoned (its `AbortController` fires and the
 * underlying SDK request is given the same deadline) and a {@link ModelTimeoutError}
 * is thrown so the calling workflow step can treat it as failed.
 *
 * `import "server-only"` keeps this module — and the credentials it reads — out
 * of the browser bundle (Requirement 22.1). The selection factory is task 6.2.
 */

/** Hard ceiling for any inference request, in milliseconds (Requirement 24.4). */
export const MODEL_TIMEOUT_CEILING_MS = 60_000;

/**
 * Default model id used when `MODEL_NAME` is not set. Uses the OpenRouter-style
 * `provider/model` id understood by both the InsForge Model Gateway and typical
 * OpenAI-compatible endpoints.
 */
const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Raised when an inference request exceeds its timeout (Requirement 24.4). */
export class ModelTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Model inference timed out after ${timeoutMs}ms`);
    this.name = "ModelTimeoutError";
  }
}

/** Raised when the selected provider returns an error or an unusable response. */
export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRequestError";
  }
}

/** Resolve the model id, allowing a non-credential `MODEL_NAME` override. */
function resolveModelName(): string {
  const raw = process.env.MODEL_NAME?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_MODEL;
}

/** Clamp the requested timeout into `(0, 60_000]`, defaulting to the ceiling. */
function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return MODEL_TIMEOUT_CEILING_MS;
  }
  return Math.min(timeoutMs, MODEL_TIMEOUT_CEILING_MS);
}

/** OpenAI-compatible chat message shape shared by both provider paths. */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Flatten an {@link InferenceRequest} into an OpenAI-compatible message list:
 * the `system` prompt first, then the conversation turns in order.
 */
function buildMessages(req: InferenceRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (req.system && req.system.trim().length > 0) {
    messages.push({ role: "system", content: req.system });
  }
  for (const m of req.messages) {
    messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

/**
 * Run `fn` under a hard deadline. On timeout the shared {@link AbortController}
 * is aborted (cancelling an in-flight `fetch`) and a {@link ModelTimeoutError}
 * is thrown; the underlying provider request is abandoned (Requirement 24.4).
 */
async function runWithTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Extract the assistant text from an OpenAI-compatible completion payload. */
function extractCompletionText(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ModelRequestError(
      "Model provider returned a response without text content",
    );
  }
  return content;
}

/**
 * Route a request through a direct OpenAI-compatible endpoint
 * (MODEL_BASE_URL + MODEL_API_KEY — Requirement 24.1).
 */
async function completeViaDirect(
  endpoint: ModelProviderEndpoint,
  req: InferenceRequest,
  timeoutMs: number,
): Promise<string> {
  const url = `${endpoint.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return runWithTimeout(timeoutMs, async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: resolveModelName(),
        messages: buildMessages(req),
      }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ModelRequestError(
        `Model provider request failed: ${response.status} ${detail}`.trim(),
      );
    }

    const payload = await response.json();
    return extractCompletionText(payload);
  });
}

/**
 * Route a request through the InsForge Model Gateway via the `@insforge/sdk`
 * AI client (the preferred provider — Requirement 24.2).
 */
async function completeViaInsforge(
  endpoint: ModelProviderEndpoint,
  req: InferenceRequest,
  timeoutMs: number,
): Promise<string> {
  // The SDK is given the same deadline so the underlying HTTP request is
  // aborted; runWithTimeout independently guarantees we stop waiting.
  const client = createClient({
    baseUrl: endpoint.baseUrl,
    anonKey: endpoint.apiKey,
    timeout: timeoutMs,
  });

  return runWithTimeout(timeoutMs, async () => {
    const completion = await client.ai.chat.completions.create({
      model: resolveModelName(),
      messages: buildMessages(req),
    });
    return extractCompletionText(completion);
  });
}

/**
 * Live ModelClient. Resolves the provider via the fixed precedence on every
 * call so configuration changes (or per-request differences) are honored
 * deterministically.
 */
export class LiveModelClient implements ModelClient {
  readonly mode: RunMode = "live";

  isConfigured(): boolean {
    return isModelConfigured();
  }

  /**
   * Resolve the provider for this client from the current environment using the
   * pure precedence rule (InsForge Model Gateway preferred — Requirement 24.2).
   * Returns `null` when no provider is configured.
   */
  resolveProvider(): ModelProvider | null {
    const creds = readModelProviderCredentials();
    return resolveModelProvider({
      insforge: creds.insforge !== null,
      openAiCompatible: creds.direct !== null,
    });
  }

  async complete(
    req: InferenceRequest,
  ): Promise<{ text: string; simulated: boolean }> {
    const creds = readModelProviderCredentials();
    const provider = resolveModelProvider({
      insforge: creds.insforge !== null,
      openAiCompatible: creds.direct !== null,
    });

    if (provider === null) {
      // No live provider configured: the factory (task 6.2) should select the
      // no fallback client available, so reaching here is a misconfiguration.
      throw new ModelRequestError(
        "LiveModelClient.complete invoked with no inference provider configured",
      );
    }

    const timeoutMs = clampTimeout(req.timeoutMs);

    const text =
      provider === "insforge"
        ? await completeViaInsforge(creds.insforge!, req, timeoutMs)
        : await completeViaDirect(creds.direct!, req, timeoutMs);

    return { text, simulated: false };
  }
}

/** Construct a live ModelClient. */
export function createLiveModelClient(): ModelClient {
  return new LiveModelClient();
}
