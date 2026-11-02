/**
 * Make a string safe to use as a download/save file name: drop path separators, control chars, and the
 * characters Windows/macOS reject, collapse whitespace, and cap the length. Never returns empty.
 */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ") // drop path/reserved + control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim(); // a 120-char cut can land mid-space; trim again so the name never ends in a space
  return cleaned || "file";
}

/** A human-friendly client label for file names ("Walk-in" for walk-ins). */
export function clientFileLabel(client: {
  firstName: string;
  lastName: string | null;
  isWalkIn?: boolean;
}): string {
  if (client.isWalkIn) return "Walk-in";
  return `${client.firstName}${client.lastName ? ` ${client.lastName}` : ""}`.trim() || "Customer";
}
