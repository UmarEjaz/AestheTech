/** "1 loyalty point" / "40 loyalty points", for the messages that say what happened to a client's points. */
export function pointsLabel(points: number): string {
  return `${points} loyalty point${points === 1 ? "" : "s"}`;
}
