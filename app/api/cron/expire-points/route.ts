import { NextResponse } from "next/server";
import { processExpiredPoints } from "@/lib/actions/loyalty";

/** Cron endpoint to process expired loyalty points. Protected by CRON_SECRET Bearer token. */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processExpiredPoints({ skipAuth: true });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    message: "Expired points processed",
    ...result.data,
  });
}
