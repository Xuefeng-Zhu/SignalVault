import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import Home from "@/app/page";

/**
 * Unit tests for the SignalVault landing page (app/page.tsx).
 *
 * Validates:
 * - Requirement 2.1: the product name "SignalVault" and the tagline
 *   "Turn public web changes into auditable market intelligence." render
 *   on the root route.
 * - Requirement 2.6: the architecture strip shows the four integration
 *   platforms in the exact order Apify, Box, Mastra, InsForge.
 */
describe("Landing page (Home)", () => {
  it("renders the product name (Requirement 2.1)", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "SignalVault" }),
    ).toBeInTheDocument();
  });

  it("renders the tagline (Requirement 2.1)", () => {
    render(<Home />);

    expect(
      screen.getByText(
        "Turn public web changes into auditable market intelligence.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the four integrations in the exact order Apify, Box, Mastra, InsForge (Requirement 2.6)", () => {
    render(<Home />);

    // Scope to the architecture strip so unrelated lists cannot affect order.
    const strip = screen.getByRole("region", { name: /built on/i });
    const items = within(strip).getAllByRole("listitem");

    expect(items).toHaveLength(4);

    const expectedOrder = ["Apify", "Box", "Mastra", "InsForge"];
    expectedOrder.forEach((name, index) => {
      // textContent includes the index label and role; assert the platform
      // name appears in the list item at the expected position.
      expect(items[index]).toHaveTextContent(name);
    });

    // Cross-check: the relative order of the names matches exactly, guarding
    // against a name appearing in the wrong slot via substring overlap.
    const orderedNames = items.map((item) =>
      expectedOrder.find((name) => item.textContent?.includes(name)),
    );
    expect(orderedNames).toEqual(expectedOrder);
  });
});
