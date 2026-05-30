import { describe, expect, it } from "vitest";

import {
  LOGIN_PATH,
  PROTECTED_PREFIXES,
  REDIRECT_PARAM,
  isDemoModeEnabled,
  isProtectedPath,
} from "./routes";

/**
 * Unit tests for the pure, Edge-safe auth routing helpers (task 8.1). These
 * cover which routes the middleware gates (Requirement 1.1) and the demo-flag
 * parsing the middleware uses to bypass auth (Requirement 1.6).
 */
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

  describe("isDemoModeEnabled", () => {
    it("treats true/1/yes (any case, trimmed) as enabled", () => {
      for (const value of ["true", "TRUE", " true ", "1", "yes", "YES"]) {
        expect(isDemoModeEnabled(value)).toBe(true);
      }
    });

    it("treats unset and every other value as disabled", () => {
      for (const value of [undefined, "", "false", "0", "no", "off", "demo"]) {
        expect(isDemoModeEnabled(value)).toBe(false);
      }
    });
  });

  it("exposes stable redirect wiring constants", () => {
    expect(LOGIN_PATH).toBe("/login");
    expect(REDIRECT_PARAM).toBe("redirectTo");
  });
});
