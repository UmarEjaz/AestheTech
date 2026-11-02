import { describe, it, expect } from "vitest";
import { settingsSchema, type SettingsFormData } from "./settings-form-schema";

const valid: SettingsFormData = {
  salonName: "Glow",
  salonAddress: null,
  salonPhone: null,
  salonEmail: null,
  timezone: "UTC",
  currencyCode: "USD",
  taxRate: 0,
  taxNumber: "GB123456789",
  receiptFooter: "Thank you!",
  businessHoursStart: "09:00",
  businessHoursEnd: "19:00",
  appointmentInterval: 30,
  defaultBookingMode: "APPOINTMENT",
  receiptSize: "A5",
  loyaltyProgramEnabled: true,
  loyaltyPointsPerDollar: 1,
  goldThreshold: 500,
  platinumThreshold: 1000,
  memberMultiplier: 1,
  goldMultiplier: 1.5,
  platinumMultiplier: 2,
  pointsPerDollar: 100,
  birthdayBonusEnabled: true,
  birthdayBonusPoints: 50,
  pointsExpiryEnabled: false,
  pointsExpiryMonths: 12,
  allowPartialPayment: false,
  allowPayLater: false,
};

// The settings form submits `...data` straight to the server action, so what the schema lets through
// is exactly what gets saved; these pin the three receipt fields' rules.
describe("settingsSchema — receipt fields", () => {
  it("accepts the receipt size, tax number and footer note and keeps them in the parsed data", () => {
    const parsed = settingsSchema.parse(valid);
    expect(parsed).toMatchObject({ receiptSize: "A5", taxNumber: "GB123456789", receiptFooter: "Thank you!" });
  });

  it("accepts an empty tax number and footer (optional fields)", () => {
    expect(settingsSchema.safeParse({ ...valid, taxNumber: null, receiptFooter: "" }).success).toBe(true);
  });

  it("rejects an unknown receipt size", () => {
    expect(settingsSchema.safeParse({ ...valid, receiptSize: "LETTER" }).success).toBe(false);
  });

  it("rejects a tax number over 50 characters and a footer over 300", () => {
    expect(settingsSchema.safeParse({ ...valid, taxNumber: "x".repeat(51) }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, receiptFooter: "x".repeat(301) }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, receiptFooter: "x".repeat(300) }).success).toBe(true);
  });
});
