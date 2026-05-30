import { z } from 'zod';

import { SourceTypeEnum, type SourceType } from './enums';

/**
 * Client-side (and reusable) validation for the Add Company form.
 *
 * A Company is defined by a name (1–200 chars), a syntactically valid hostname
 * domain, and between 3 and 5 Watched_Sources — each a valid http(s) URL paired
 * with exactly one source type, with no duplicate URLs.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

/**
 * Matches a syntactically valid hostname: one or more dot-separated labels
 * followed by a final label. Each label is 1–63 chars, starts and ends with an
 * alphanumeric character, and may contain hyphens in between. Requires at least
 * one dot so bare single labels (e.g. "localhost") are not accepted as a
 * company domain.
 */
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/** True when `value` is a syntactically valid hostname. */
export function isValidHostname(value: string): boolean {
  return HOSTNAME_REGEX.test(value.trim());
}

/** True when `value` parses as an absolute HTTP or HTTPS URL. */
export function isValidHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export const MIN_URLS = 3;
export const MAX_URLS = 5;
export const NAME_MAX = 200;

/** Validation messages, centralized so the UI and tests can reference them. */
export const ADD_COMPANY_MESSAGES = {
  nameRequired: 'Company name is required',
  nameTooLong: `Company name must be ${NAME_MAX} characters or fewer`,
  domainInvalid: 'Enter a valid domain hostname (for example, example.com)',
  urlCount: `Add between ${MIN_URLS} and ${MAX_URLS} URLs`,
  urlEmpty: 'Enter a valid http(s) URL',
  urlInvalid: (url: string) => `"${url}" is not a valid http(s) URL`,
  urlDuplicate: (url: string) => `"${url}" is a duplicate URL`,
} as const;

/** A single URL row: a public URL and its source-type category. */
export const UrlRowSchema = z.object({
  url: z.string(),
  sourceType: SourceTypeEnum,
});

export type UrlRow = z.infer<typeof UrlRowSchema>;

/**
 * Full Add Company form schema. Per-row URL validity and duplicate detection
 * are enforced in `superRefine` so that issues are attached to the precise
 * `['urls', index, 'url']` path, letting the UI identify the offending row.
 */
export const AddCompanyFormSchema = z
  .object({
    name: z
      .string()
      .refine((v) => v.trim().length >= 1, ADD_COMPANY_MESSAGES.nameRequired)
      .refine((v) => v.trim().length <= NAME_MAX, ADD_COMPANY_MESSAGES.nameTooLong),
    domain: z.string().refine(isValidHostname, ADD_COMPANY_MESSAGES.domainInvalid),
    urls: z
      .array(UrlRowSchema)
      .min(MIN_URLS, ADD_COMPANY_MESSAGES.urlCount)
      .max(MAX_URLS, ADD_COMPANY_MESSAGES.urlCount),
  })
  .superRefine((data, ctx) => {
    // Per-row URL validity (Req 4.4) — added first so validity takes
    // precedence over the duplicate message for the same row.
    data.urls.forEach((row, index) => {
      if (!isValidHttpUrl(row.url)) {
        const trimmed = row.url.trim();
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['urls', index, 'url'],
          message:
            trimmed.length === 0
              ? ADD_COMPANY_MESSAGES.urlEmpty
              : ADD_COMPANY_MESSAGES.urlInvalid(trimmed),
        });
      }
    });

    // Duplicate URL detection (Req 4.6) — compares trimmed values and flags
    // every occurrence after the first.
    const seen = new Map<string, number>();
    data.urls.forEach((row, index) => {
      const key = row.url.trim();
      if (key.length === 0) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['urls', index, 'url'],
          message: ADD_COMPANY_MESSAGES.urlDuplicate(key),
        });
      } else {
        seen.set(key, index);
      }
    });
  });

export type AddCompanyFormValues = z.infer<typeof AddCompanyFormSchema>;

/** Field-level error shape consumed by the Add Company form UI. */
export interface AddCompanyFormErrors {
  /** Name field message (Req 4.5). */
  name?: string;
  /** Domain field message (Req 4.5). */
  domain?: string;
  /** URL-count message for the 3–5 bound (Req 4.3). */
  urls?: string;
  /** Per-row URL message (invalid Req 4.4, or duplicate Req 4.6); index-aligned. */
  rows: (string | undefined)[];
}

/**
 * Validate form values and translate Zod issues into a field-aligned error
 * object. Returns `null` when the form is valid.
 */
export function validateAddCompanyForm(
  values: AddCompanyFormValues
): AddCompanyFormErrors | null {
  const result = AddCompanyFormSchema.safeParse(values);
  if (result.success) {
    return null;
  }

  const errors: AddCompanyFormErrors = {
    rows: values.urls.map(() => undefined),
  };

  for (const issue of result.error.issues) {
    const [head, index] = issue.path;
    if (head === 'name') {
      errors.name ??= issue.message;
    } else if (head === 'domain') {
      errors.domain ??= issue.message;
    } else if (head === 'urls' && typeof index === 'number') {
      errors.rows[index] ??= issue.message;
    } else if (head === 'urls') {
      errors.urls ??= issue.message;
    }
  }

  return errors;
}

export { SourceTypeEnum, type SourceType };
