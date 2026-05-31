import { describe, expect, it } from "vitest";

import {
  LOGIN_PATH,
  PROTECTED_PREFIXES,
  REDIRECT_PARAM,
  isProtectedPath,
} from "./routes";

/** Unit tests for the pure, Edge-safe auth routing helpers (task 8.1). */
describe("auth/routes", () => {
  describe("isProtectedPath", () => {
    it("protects the company and scan routes and everything beneath them", () => {
      expect(isProtectedPath("/companies")).toBe(true);
      expect(isProtectedPath("/companies/new")).toBe(true);
      expect(isProtectedPath("/companies/abc-123")).toBe(true);
      expect(isProtectedPath("/scans/abc-123")).toBe(true);
    });

    it("leaves the landing page, auth flow, and other public routes open", () => {
      expect(isProtectedPath("/")).toBe(false);
      expect(isProtectedPath(LOGIN_PATH)).toBe(false);
      expect(isProtectedPath("/about")).toBe(false);
    });

    it("does not protect lookalike prefixes that are not a segment boundary", () => {
      // `/companies-public` shares the prefix text but is a different route.
      expect(isProtectedPath("/companies-public")).toBe(false);
      expect(isProtectedPath("/scans-archive")).toBe(false);
    });

    it("every declared protected prefix matches itself", () => {
      for (const prefix of PROTECTED_PREFIXES) {
        expect(isProtectedPath(prefix)).toBe(true);
      }
    });
  });

  it("exposes stable redirect wiring constants", () => {
    expect(LOGIN_PATH).toBe("/login");
    expect(REDIRECT_PARAM).toBe("redirectTo");
  });
});
