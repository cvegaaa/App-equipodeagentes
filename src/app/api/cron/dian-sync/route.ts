import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pollDianSync } from "@/server/jobs/dian-sync-poll";

// Trigger DIAN-sync (docs/connector-integration-decision.md — mecanismo elegido: polling). No
// consulta Alegra si el secreto es incorrecto o falta.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const result = await pollDianSync();
  return NextResponse.json({ ok: true, data: result });
}
