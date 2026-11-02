import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { expirePoints } from "@/lib/loyalty-expiry";

/** Compare the header with the expected value in constant time, so timing can't reveal the secret. */
function matchesSecret(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Cron endpoint to process expired loyalty points at every salon. Protected by CRON_SECRET Bearer token. */
export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !matchesSecret(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await expirePoints(null);
    return NextResponse.json({
      message: "Expired points processed",
      ...result,
    });
  } catch (error) {
    console.error("Error processing expired points:", error);
    return NextResponse.json({ error: "Failed to process expired points" }, { status: 500 });
  }
}
