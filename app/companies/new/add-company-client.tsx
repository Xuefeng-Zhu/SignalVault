"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { AddCompanyForm } from "@/components/add-company-form";
import type { AddCompanyFormValues } from "@/lib/schemas";

/** Read the created company id from a `POST /api/companies` `201` body. */
function extractCompanyId(body: unknown): string | null {
  if (body == null || typeof body !== "object") {
    return null;
  }
  const company = (body as Record<string, unknown>).company;
  if (company != null && typeof company === "object") {
    const id = (company as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return null;
}

/**
 * Client wrapper that hosts {@link AddCompanyForm} and wires the
 * submit → navigate behavior (Requirements 4.1, 4.9).
 *
 * The form owns all client-side validation; this component only supplies an
 * `onSubmit` that runs after validation passes. It POSTs the validated values
 * to `POST /api/companies` (the same endpoint the form would call on its own)
 * and, on a successful `201 { company, sources }`, reads the new company id and
 * navigates the User to the Company detail page `/companies/{id}` (Req 4.9).
 *
 * On a non-OK response, a missing company id, or a network error it throws so
 * the form surfaces its own inline "The company could not be created" message
 * and re-enables submission for a retry. We intentionally do not navigate in
 * that case so no partial success is implied.
 */
export function AddCompanyClient() {
  const router = useRouter();

  const handleSubmit = React.useCallback(
    async (values: AddCompanyFormValues) => {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const body: unknown = await response.json().catch(() => null);
      const companyId = extractCompanyId(body);
      if (companyId == null) {
        throw new Error("Create response did not include a company id");
      }

      // Navigate to the new Company detail page (Req 4.9). refresh() ensures the
      // dashboard/detail server components re-read the freshly created records.
      router.push(`/companies/${companyId}`);
      router.refresh();
    },
    [router],
  );

  return <AddCompanyForm onSubmit={handleSubmit} />;
}
