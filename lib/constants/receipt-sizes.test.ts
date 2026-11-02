import { describe, it, expect } from "vitest";
import {
  RECEIPT_SIZES,
  receiptFamily,
  asReceiptSize,
  RECEIPT_PAGE_CSS,
  RECEIPT_CONTENT_WIDTH,
} from "./receipt-sizes";

describe("receiptFamily", () => {
  it("treats thermal sizes as slips", () => {
    expect(receiptFamily("THERMAL_80")).toBe("slip");
    expect(receiptFamily("THERMAL_58")).toBe("slip");
  });
  it("treats A5/A4 as documents", () => {
    expect(receiptFamily("A5")).toBe("document");
    expect(receiptFamily("A4")).toBe("document");
  });
});

describe("asReceiptSize", () => {
  it("passes through valid sizes", () => {
    for (const s of RECEIPT_SIZES) expect(asReceiptSize(s)).toBe(s);
  });
  it("falls back to thermal 80mm for anything invalid", () => {
    expect(asReceiptSize(null)).toBe("THERMAL_80");
    expect(asReceiptSize(undefined)).toBe("THERMAL_80");
    expect(asReceiptSize("LETTER")).toBe("THERMAL_80");
  });
});

describe("geometry tables", () => {
  it("has a page size and width for every receipt size", () => {
    for (const s of RECEIPT_SIZES) {
      expect(RECEIPT_PAGE_CSS[s]).toBeTruthy();
      expect(RECEIPT_CONTENT_WIDTH[s]).toBeTruthy();
    }
  });
  it("maps thermal sizes to their millimetre page widths", () => {
    expect(RECEIPT_PAGE_CSS.THERMAL_80).toContain("80mm");
    expect(RECEIPT_PAGE_CSS.THERMAL_58).toContain("58mm");
    expect(RECEIPT_PAGE_CSS.A5).toBe("A5");
    expect(RECEIPT_PAGE_CSS.A4).toBe("A4");
  });
});
