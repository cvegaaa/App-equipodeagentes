import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweepStuckRuns } from "@/server/jobs/stuck-run-sweeper";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const result = await sweepStuckRuns();
  return NextResponse.json({ ok: true, data: result });
}
