import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * Shared API error envelope + JSON response helpers for SignalVault's route
 * handlers (design "API Routes" section).
 *
 * This is the single canonical place that builds the {@link ApiError} envelope
 * every handler returns on failure, the fixed code → HTTP-status mapping, and
 * the success/error response constructors. Handlers must route failures through
 * these helpers so the envelope stays uniform across every route.
 *
 * Two response flavours are provided because the handlers use both:
 *  - {@link errorResponse} / {@link jsonResponse} return a plain Web `Response`
 *    (used by the companies + scans route handlers).
 *  - {@link jsonError} / {@link jsonOk} / {@link parseJsonBody} return a
 *    `NextResponse` (used by the integrations handler, which is typed against
 *    `next/server`).
 * Both flavours emit the identical envelope shape and status codes.
 *
 * Envelope (from the design):
 *   type ApiError = { error: { code: string; message: string; field?: string } };
 *   codes: VALIDATION, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL
 */

/** The fixed set of error codes the design enumerates. */
export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

/** The standard error envelope returned to the browser on any failure. */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    /** The offending field, when the failure is a field-level validation error. */
    field?: string;
  };
}

/**
 * Canonical code → HTTP status mapping. Kept here (not inline) so every handler
 * maps a given failure to the same status.
 */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Build the bare {@link ApiError} envelope object (no HTTP wrapping). */
export function apiErrorBody(
  code: ApiErrorCode,
  message: string,
  field?: string,
): ApiError {
  const error: ApiError["error"] = { code, message };
  if (field !== undefined) {
    error.field = field;
  }
  return { error };
}

/* -------------------------------------------------------------------------- */
/* Web `Response` flavour                                                     */
/* -------------------------------------------------------------------------- */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

/**
 * Construct an error `Response` carrying the {@link ApiError} envelope, with the
 * HTTP status mapped from `code`. Uses the Web `Response` (available in the
 * Next.js route-handler runtime and Node 18+).
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  field?: string,
): Response {
  return new Response(JSON.stringify(apiErrorBody(code, message, field)), {
    status: API_ERROR_STATUS[code],
    headers: JSON_HEADERS,
  });
}

/** Construct a success `Response` (default 200) carrying `body` as JSON. */
export function apiOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Alias of {@link apiError}. Some handlers import the `*Response` names; both
 * point at the same Web `Response` builder so the envelope is identical.
 */
export const errorResponse = apiError;

/** Alias of {@link apiOk} (see {@link errorResponse}). */
export const jsonResponse = apiOk;

/* -------------------------------------------------------------------------- */
/* `NextResponse` flavour                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Construct an error {@link NextResponse} carrying the {@link ApiError}
 * envelope with the status mapped from `code`.
 */
export function jsonError(
  code: ApiErrorCode,
  message: string,
  field?: string,
): NextResponse<ApiError> {
  return NextResponse.json(apiErrorBody(code, message, field), {
    status: API_ERROR_STATUS[code],
  });
}

/** Construct a success {@link NextResponse} (default 200) carrying `body`. */
export function jsonOk<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status });
}

/**
 * Result of {@link parseJsonBody}: either the validated `data`, or a
 * ready-to-return `400 VALIDATION` response naming the offending field.
 */
export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<ApiError> };

/**
 * Parse a request's JSON body and validate it against a Zod schema. A malformed
 * body or a schema failure becomes a `400 VALIDATION` envelope (with the first
 * offending field path when available) rather than a thrown error / 500.
 *
 * Generic over the schema type (`S extends z.ZodTypeAny`) so it accepts a union
 * of schema types — e.g. the Apify/Box `configSchemaFor` union — and infers the
 * validated output via `z.infer<S>`.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonError("VALIDATION", "Request body must be valid JSON."),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field =
      typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
    return {
      ok: false,
      response: jsonError(
        "VALIDATION",
        issue?.message ?? "Invalid request body.",
        field,
      ),
    };
  }

  return { ok: true, data: parsed.data as z.infer<S> };
}
