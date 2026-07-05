/**
 * Build the list of selectable IANA timezones with a friendly "(offset) Zone" label.
 * Shared by the salon-creation form and the settings form. Runs in the browser.
 */
export function getTimezoneOptions(): { value: string; label: string }[] {
  const supported = Intl.supportedValuesOf("timeZone");
  // Some runtimes omit "UTC" from supportedValuesOf even though it's a valid zone
  // (and our default). Ensure it's always selectable.
  const timezones = supported.includes("UTC") ? supported : ["UTC", ...supported];
  return timezones.map((tz) => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(now);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return { value: tz, label: `(${offset}) ${tz.replace(/_/g, " ")}` };
  });
}

/** The browser/OS timezone, used as a sensible default. Falls back to "UTC". */
export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
