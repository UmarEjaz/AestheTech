import { describe, it, expect } from "vitest";
import { safeFilename, clientFileLabel } from "./filename";

describe("safeFilename", () => {
  it("strips path/reserved characters and collapses whitespace", () => {
    expect(safeFilename('Jane/Doe: "Receipt"  INV?001')).toBe("Jane Doe Receipt INV 001");
  });
  it("never returns empty", () => {
    expect(safeFilename("   ///   ")).toBe("file");
  });
  it("caps length at 120 chars with no trailing space", () => {
    const out = safeFilename("a".repeat(130) + " tail");
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toBe(out.trimEnd()); // no trailing space from a mid-space cut
  });
});

describe("clientFileLabel", () => {
  it("joins first and last name", () => {
    expect(clientFileLabel({ firstName: "Jennifer", lastName: "Smith" })).toBe("Jennifer Smith");
  });
  it("uses Walk-in for walk-in clients", () => {
    expect(clientFileLabel({ firstName: "", lastName: null, isWalkIn: true })).toBe("Walk-in");
  });
  it("handles a missing last name", () => {
    expect(clientFileLabel({ firstName: "Robert", lastName: null })).toBe("Robert");
  });
  it("falls back to 'Customer' for a non-walk-in with no name", () => {
    expect(clientFileLabel({ firstName: "", lastName: null })).toBe("Customer");
  });
});
