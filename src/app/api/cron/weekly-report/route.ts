import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { generateWeeklyReportsForAllOrgs } from "@/server/reports/weekly-report";

function lastCompletedWeekStart(now: Date): Date {
  const dayOfWeek = now.getUTCDay(); // 0=domingo ... 1=lunes
  const daysSinceLastMonday = ((dayOfWeek + 6) % 7) + 7; // arranca el lunes de la semana anterior
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - daysSinceLastMonday);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const result = await generateWeeklyReportsForAllOrgs(lastCompletedWeekStart(new Date()));
  return NextResponse.json({ ok: true, data: result });
}
