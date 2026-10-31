import "server-only";
import { getSettings } from "@/lib/actions/settings";
import { formatInTz } from "@/lib/utils/timezone";

/**
 * The cutoff for "overdue". Due dates are date-only values stored at UTC midnight, so we compare
 * against the salon's CURRENT calendar date turned back into a UTC-midnight instant. Using an
 * absolute timezone boundary here (e.g. start-of-today in a UTC- zone = 04:00Z) would wrongly
 * flag an invoice due today (00:00Z) as overdue. Shared by the invoice actions, the sale page and the
 * invoice email so all derive the same effective status. Pass the salon `timezone` when the caller
 * already loaded the settings, to skip a second settings query.
 */
export async function salonOverdueCutoff(timezone?: string): Promise<Date> {
  let tz = timezone;
  if (!tz) {
    const s = await getSettings();
    tz = s.success ? s.data.timezone : "UTC";
  }
  const localDate = formatInTz(new Date(), "yyyy-MM-dd", tz);
  return new Date(`${localDate}T00:00:00Z`);
}
