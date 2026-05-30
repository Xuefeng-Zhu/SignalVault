"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ADD_COMPANY_MESSAGES,
  MAX_URLS,
  MIN_URLS,
  NAME_MAX,
  SourceTypeEnum,
  validateAddCompanyForm,
  type AddCompanyFormErrors,
  type AddCompanyFormValues,
  type SourceType,
  type UrlRow,
} from "@/lib/schemas";

const SOURCE_TYPES = SourceTypeEnum.options;
const DEFAULT_SOURCE_TYPE: SourceType = SOURCE_TYPES[0];

/** Build the initial set of empty URL rows (the minimum allowed count). */
function initialRows(): UrlRow[] {
  return Array.from({ length: MIN_URLS }, () => ({
    url: "",
    sourceType: DEFAULT_SOURCE_TYPE,
  }));
}

export interface AddCompanyFormProps {
  /**
   * Called with validated values when the form passes client-side validation.
   * Preferred submit contract — keeps the form self-contained. May be async;
   * the form disables submission while it resolves.
   */
  onSubmit?: (values: AddCompanyFormValues) => void | Promise<void>;
  /**
   * Endpoint to POST validated values to when `onSubmit` is not provided.
   * Defaults to `/api/companies`.
   */
  action?: string;
  className?: string;
}

/**
 * Add Company form (Requirement 4).
 *
 * Collects a company name (1–200 chars), a hostname domain, and 3–5 URL rows
 * each with a source type. Performs client-side validation and surfaces
 * field-specific inline messages:
 *  - fewer than 3 / more than 5 URLs (4.3)
 *  - a URL that is not a valid http(s) URL, identifying which URL (4.4)
 *  - empty/too-long name or invalid hostname domain, identifying the field (4.5)
 *  - duplicate URLs, identifying the duplicate (4.6)
 *
 * On a valid submit it calls `onSubmit(values)` if provided, otherwise POSTs
 * to `action` (default `/api/companies`). The hosting page wires navigation.
 */
export function AddCompanyForm({
  onSubmit,
  action = "/api/companies",
  className,
}: AddCompanyFormProps) {
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [rows, setRows] = React.useState<UrlRow[]>(initialRows);
  const [errors, setErrors] = React.useState<AddCompanyFormErrors | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  // Only show inline errors after the first submit attempt to avoid yelling
  // at the user before they have had a chance to fill the form in.
  const [submitted, setSubmitted] = React.useState(false);

  const values: AddCompanyFormValues = React.useMemo(
    () => ({ name, domain, urls: rows }),
    [name, domain, rows]
  );

  const revalidate = React.useCallback(
    (next: AddCompanyFormValues) => {
      if (submitted) {
        setErrors(validateAddCompanyForm(next));
      }
    },
    [submitted]
  );

  const updateRow = (index: number, patch: Partial<UrlRow>) => {
    setRows((prev) => {
      const next = prev.map((row, i) =>
        i === index ? { ...row, ...patch } : row
      );
      revalidate({ name, domain, urls: next });
      return next;
    });
  };

  const addRow = () => {
    if (rows.length >= MAX_URLS) return;
    setRows((prev) => {
      const next = [...prev, { url: "", sourceType: DEFAULT_SOURCE_TYPE }];
      revalidate({ name, domain, urls: next });
      return next;
    });
  };

  const removeRow = (index: number) => {
    if (rows.length <= MIN_URLS) return;
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      revalidate({ name, domain, urls: next });
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setSubmitError(null);

    const validationErrors = validateAddCompanyForm(values);
    setErrors(validationErrors);
    if (validationErrors) {
      return;
    }

    setSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(values);
      } else {
        const response = await fetch(action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `The company could not be created: ${err.message}`
          : "The company could not be created."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canAddRow = rows.length < MAX_URLS;
  const canRemoveRow = rows.length > MIN_URLS;

  return (
    <form
      onSubmit={handleSubmit}
      className={className}
      noValidate
      aria-label="Add company"
    >
      <div className="space-y-6">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            name="name"
            value={name}
            maxLength={NAME_MAX}
            placeholder="Acme AI"
            aria-invalid={errors?.name ? true : undefined}
            aria-describedby={errors?.name ? "company-name-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              revalidate({ name: e.target.value, domain, urls: rows });
            }}
          />
          {errors?.name ? (
            <p
              id="company-name-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {errors.name}
            </p>
          ) : null}
        </div>

        {/* Domain */}
        <div className="space-y-2">
          <Label htmlFor="company-domain">Domain</Label>
          <Input
            id="company-domain"
            name="domain"
            value={domain}
            placeholder="example.com"
            aria-invalid={errors?.domain ? true : undefined}
            aria-describedby={
              errors?.domain ? "company-domain-error" : undefined
            }
            onChange={(e) => {
              setDomain(e.target.value);
              revalidate({ name, domain: e.target.value, urls: rows });
            }}
          />
          {errors?.domain ? (
            <p
              id="company-domain-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {errors.domain}
            </p>
          ) : null}
        </div>

        {/* URL rows */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">
            Public URLs ({MIN_URLS}–{MAX_URLS})
          </legend>

          {rows.map((row, index) => {
            const rowError = errors?.rows[index];
            const urlId = `url-${index}`;
            const typeId = `source-type-${index}`;
            return (
              <div key={index} className="space-y-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={urlId} className="sr-only">
                      URL {index + 1}
                    </Label>
                    <Input
                      id={urlId}
                      name={`urls[${index}].url`}
                      value={row.url}
                      placeholder="https://example.com/pricing"
                      aria-label={`URL ${index + 1}`}
                      aria-invalid={rowError ? true : undefined}
                      aria-describedby={rowError ? `${urlId}-error` : undefined}
                      onChange={(e) => updateRow(index, { url: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:w-44">
                    <Label htmlFor={typeId} className="sr-only">
                      Source type for URL {index + 1}
                    </Label>
                    <Select
                      id={typeId}
                      name={`urls[${index}].sourceType`}
                      value={row.sourceType}
                      aria-label={`Source type for URL ${index + 1}`}
                      onChange={(e) =>
                        updateRow(index, {
                          sourceType: e.target.value as SourceType,
                        })
                      }
                    >
                      {SOURCE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Remove URL ${index + 1}`}
                    disabled={!canRemoveRow}
                    onClick={() => removeRow(index)}
                  >
                    <span aria-hidden="true">&times;</span>
                  </Button>
                </div>
                {rowError ? (
                  <p
                    id={`${urlId}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {rowError}
                  </p>
                ) : null}
              </div>
            );
          })}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addRow}
              disabled={!canAddRow}
            >
              Add URL
            </Button>
            <span className="text-xs text-muted-foreground">
              {rows.length} of {MAX_URLS} URLs
            </span>
          </div>

          {errors?.urls ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.urls}
            </p>
          ) : null}
        </fieldset>

        {submitError ? (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add company"}
        </Button>
      </div>
    </form>
  );
}

export { ADD_COMPANY_MESSAGES };
